"""
모델 관리 API — 로드 / 조회 / 비교
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.logging_config import get_logger
from backend.models.registry import registry

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


@router.post("/compare")
async def compare_models(req: BenchmarkRequest):
    """A/B 게이트 벤치마크 실행"""
    import os
    from pathlib import Path as P
    from backend.comparison.benchmark import BenchmarkRunner
    from backend.core.pipeline import InferencePipeline
    from backend.core.state_machine import SequenceStateMachine

    img_dir = P(req.test_images_dir)
    if not img_dir.exists():
        raise HTTPException(status_code=404, detail=f"Directory not found: {img_dir}")

    import cv2
    import numpy as np
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    files = sorted([f for f in img_dir.iterdir() if f.suffix.lower() in exts])
    if not files:
        raise HTTPException(status_code=400, detail="No images found in directory")

    test_images = []
    for f in files[:200]:  # 최대 200장
        img = cv2.imread(str(f))
        if img is not None:
            test_images.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    # 더미 레이블 (실제로는 파일명에서 파싱하거나 별도 json으로 제공)
    test_labels = [0] * len(test_images)
    test_is_target = [True] * len(test_images)

    try:
        gate_a = registry.get_gate(req.gate_a_key)
        gate_b = registry.get_gate(req.gate_b_key)
        clf = registry.get_classifier(req.classifier_key)

        sm_a = SequenceStateMachine()
        sm_b = SequenceStateMachine()

        from backend.core.pipeline import InferencePipeline
        pipeline_a = InferencePipeline(gate=gate_a, classifier=clf, state_machine=sm_a)
        pipeline_b = InferencePipeline(gate=gate_b, classifier=clf, state_machine=sm_b)

        runner = BenchmarkRunner()
        report = await runner.run(
            pipeline_a, pipeline_b,
            test_images, test_labels, test_is_target,
        )
        return JSONResponse(content=report.summary())
    except Exception as e:
        logger.error("Benchmark failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
