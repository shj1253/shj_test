"""
모델 관리 API — 로드 / 조회 / 비교
"""
from __future__ import annotations

import re
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.logging_config import get_logger
from backend.models.registry import registry

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
_TARGET_RE = re.compile(r"[Tt](\d+)", re.IGNORECASE)


def _parse_label_from_name(name: str) -> int:
    """파일명 또는 경로에서 타겟 번호 추출. T1→0, T2→1, ... 못 찾으면 -1 반환."""
    m = _TARGET_RE.search(name)
    if m:
        return int(m.group(1)) - 1  # 0-indexed
    return -1

logger = get_logger(__name__)
router = APIRouter(prefix="/models", tags=["models"])


class LoadModelRequest(BaseModel):
    gate_type: str = "patchcore"         # "patchcore" | "efficientnet"
    gate_key: str = "gate_a"
    classifier_backbone: str = "resnet50"
    classifier_key: str = "classifier"
    gate_model_path: str | None = None
    classifier_model_path: str | None = None


class SwapGateRequest(BaseModel):
    key: str


class BenchmarkRequest(BaseModel):
    gate_a_key: str = "gate_a"
    gate_b_key: str = "gate_b"
    classifier_key: str = "classifier"
    test_images_dir: str


@router.get("/list")
async def list_models():
    """등록된 모델 목록"""
    return {
        "gates": registry.list_gates(),
        "classifiers": registry.list_classifiers(),
    }


@router.post("/load")
async def load_model(req: LoadModelRequest):
    """Gate + Classifier 모델 로드"""
    try:
        # Gate 생성 및 등록
        gate = registry.create_gate(req.gate_type)
        if req.gate_model_path:
            gate.load(Path(req.gate_model_path))
        registry.register_gate(req.gate_key, gate)

        # Classifier 생성 및 등록
        clf = registry.create_classifier(backbone=req.classifier_backbone)
        if req.classifier_model_path:
            clf.load(Path(req.classifier_model_path))
        registry.register_classifier(req.classifier_key, clf)

        # 파이프라인 업데이트
        from backend.main import reinit_pipeline
        await reinit_pipeline()

        return {
            "status": "loaded",
            "gate": req.gate_key,
            "classifier": req.classifier_key,
        }
    except Exception as e:
        logger.error("Model load failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/swap-gate")
async def swap_gate(req: SwapGateRequest):
    """실시간 Gate 모델 교체"""
    try:
        registry.swap_gate(req.key)
        from backend.main import get_pipeline
        pipeline = get_pipeline()
        if pipeline:
            pipeline.swap_gate(registry.active_gate)
        return {"status": "swapped", "active_gate": req.key}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


def _load_images_from_dir(img_dir: Path, max_n: int = 200) -> tuple[list[np.ndarray], list[int]]:
    """디렉터리에서 이미지 로드. 파일명/부모 폴더명에서 타겟 레이블 파싱."""
    files = sorted([f for f in img_dir.rglob("*") if f.suffix.lower() in _IMAGE_EXTS])
    images, labels = [], []
    for f in files[:max_n]:
        img = cv2.imread(str(f))
        if img is None:
            continue
        images.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        # 파일명 우선, 없으면 부모 폴더명에서 파싱
        label = _parse_label_from_name(f.name)
        if label < 0:
            label = _parse_label_from_name(f.parent.name)
        labels.append(label)
    return images, labels


async def _run_benchmark(
    gate_a_key: str,
    gate_b_key: str,
    classifier_key: str,
    test_images: list[np.ndarray],
    test_labels: list[int],
) -> dict:
    from backend.comparison.benchmark import BenchmarkRunner
    from backend.core.pipeline import InferencePipeline
    from backend.core.state_machine import SequenceStateMachine

    for key, label in [(gate_a_key, "Gate A"), (gate_b_key, "Gate B")]:
        if key not in [g["key"] for g in registry.list_gates()]:
            raise HTTPException(
                status_code=404,
                detail=f"{label} 모델 '{key}'이 등록되지 않았습니다. 먼저 학습을 완료하세요.",
            )

    gate_a = registry.get_gate(gate_a_key)
    gate_b = registry.get_gate(gate_b_key)
    clf = registry.get_classifier(classifier_key)
    test_is_target = [True] * len(test_images)  # 테스트 이미지는 전부 타겟

    pipeline_a = InferencePipeline(gate=gate_a, classifier=clf, state_machine=SequenceStateMachine())
    pipeline_b = InferencePipeline(gate=gate_b, classifier=clf, state_machine=SequenceStateMachine())

    runner = BenchmarkRunner()
    report = await runner.run(pipeline_a, pipeline_b, test_images, test_labels, test_is_target)
    return report.summary()


@router.post("/compare")
async def compare_models(req: BenchmarkRequest):
    """디렉터리 경로 기반 A/B 게이트 벤치마크"""
    img_dir = Path(req.test_images_dir)
    if not img_dir.exists():
        raise HTTPException(status_code=404, detail=f"경로를 찾을 수 없습니다: {img_dir}")

    test_images, test_labels = _load_images_from_dir(img_dir)
    if not test_images:
        raise HTTPException(status_code=400, detail="이미지를 찾을 수 없습니다")

    try:
        result = await _run_benchmark(req.gate_a_key, req.gate_b_key, req.classifier_key, test_images, test_labels)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Benchmark failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare-upload")
async def compare_models_upload(
    files: list[UploadFile] = File(...),
    gate_a_key: str = Form("gate_a"),
    gate_b_key: str = Form("gate_b"),
    classifier_key: str = Form("classifier"),
):
    """이미지 업로드 기반 A/B 게이트 벤치마크. 파일명에서 T1~T4 레이블 자동 파싱."""
    if not files:
        raise HTTPException(status_code=400, detail="테스트 이미지를 업로드하세요")

    test_images, test_labels = [], []
    for f in files[:200]:
        content = await f.read()
        arr = np.frombuffer(content, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            continue
        test_images.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        label = _parse_label_from_name(f.filename or "")
        test_labels.append(label)

    if not test_images:
        raise HTTPException(status_code=400, detail="유효한 이미지가 없습니다")

    labeled_count = sum(1 for l in test_labels if l >= 0)
    logger.info(
        "Compare-upload", n_images=len(test_images),
        labeled=labeled_count, unlabeled=len(test_images) - labeled_count,
    )

    try:
        result = await _run_benchmark(gate_a_key, gate_b_key, classifier_key, test_images, test_labels)
        result["label_info"] = {
            "labeled": labeled_count,
            "unlabeled": len(test_images) - labeled_count,
            "tip": "파일명에 T1~T4 포함 시 분류 정확도 측정 가능 (예: T1_001.jpg)",
        }
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Compare-upload failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
