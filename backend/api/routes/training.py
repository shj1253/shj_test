"""
학습 설정 API — 타겟 수, 전처리, 증강 설정 관리
"""
from __future__ import annotations

import asyncio
import functools
from pathlib import Path
from typing import Annotated

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from backend.config import settings
from backend.data.augmentation import INTENSITY_LABELS, INTENSITY_PRESETS, FieldAugmentor
from backend.data.preprocessor import OPTIONAL_STEPS, FieldPreprocessor, PreprocessConfig
from backend.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/training", tags=["training"])

# ── 런타임 학습 설정 상태 (settings를 base로 하는 mutable 복사본) ──────────

_current_config: dict = {
    "num_targets": settings.num_targets,
    "preprocess": {
        "input_size": [224, 224],
        "optional_steps": settings.preprocess_optional.split(",") if settings.preprocess_optional else [],
        "clahe_clip_limit": 2.0,
        "clahe_tile_grid": [8, 8],
        "denoise_h": 10,
        "sharpen_amount": 1.0,
    },
    "augmentation": {
        "intensity": settings.aug_intensity,
        "n_per_target": settings.aug_n_per_target,
    },
}


# ── 요청/응답 스키마 ──────────────────────────────────────────────────────

class PreprocessConfigRequest(BaseModel):
    input_size: list[int] = Field([224, 224], description="모델 입력 크기 [H, W]")
    optional_steps: list[str] = Field(
        default_factory=list,
        description="선택 전처리 목록: clahe | denoise | sharpen | pad_square",
    )
    clahe_clip_limit: float = Field(2.0, ge=0.5, le=10.0)
    clahe_tile_grid: list[int] = Field([8, 8])
    denoise_h: int = Field(10, ge=1, le=50)
    sharpen_amount: float = Field(1.0, ge=0.0, le=2.0)

    @field_validator("optional_steps")
    @classmethod
    def validate_steps(cls, v: list[str]) -> list[str]:
        valid = set(OPTIONAL_STEPS.keys())
        invalid = set(v) - valid
        if invalid:
            raise ValueError(f"Invalid optional steps: {invalid}. Valid: {valid}")
        return v

    @field_validator("input_size", "clahe_tile_grid")
    @classmethod
    def validate_two_ints(cls, v: list[int]) -> list[int]:
        if len(v) != 2 or any(x <= 0 for x in v):
            raise ValueError("Must be a list of 2 positive integers")
        return v


class AugConfigRequest(BaseModel):
    intensity: str = Field(
        "medium",
        description="증강 강도: weak|medium_weak|medium|medium_strong|strong|extreme",
    )
    n_per_target: int = Field(500, ge=10, le=5000, description="타겟당 증강 이미지 수")

    @field_validator("intensity")
    @classmethod
    def validate_intensity(cls, v: str) -> str:
        if v not in INTENSITY_PRESETS:
            raise ValueError(f"Invalid intensity: {v!r}. Valid: {list(INTENSITY_PRESETS.keys())}")
        return v


class TrainingConfigRequest(BaseModel):
    num_targets: int = Field(
        ...,
        ge=1,
        le=20,
        description="검출할 타겟 수 (현장 적용 시 변경 가능)",
    )
    preprocess: PreprocessConfigRequest
    augmentation: AugConfigRequest


# ── 엔드포인트 ─────────────────────────────────────────────────────────────

@router.get("/config")
def get_training_config():
    """현재 학습 설정 + 전처리 메타데이터 반환 (UI 초기 렌더링용)"""
    preprocessor = FieldPreprocessor(
        PreprocessConfig.from_dict({
            **_current_config["preprocess"],
            "input_size": tuple(_current_config["preprocess"]["input_size"]),
            "clahe_tile_grid": tuple(_current_config["preprocess"]["clahe_tile_grid"]),
        })
    )
    return {
        "current": _current_config,
        "meta": {
            "preprocess": preprocessor.get_info(),
            "augmentation": {
                "intensity_options": INTENSITY_LABELS,
                "intensity_presets_keys": list(INTENSITY_PRESETS.keys()),
            },
        },
    }


@router.post("/config")
def update_training_config(req: TrainingConfigRequest):
    """학습 설정 업데이트 (타겟 수 / 전처리 / 증강)"""
    global _current_config

    _current_config = {
        "num_targets": req.num_targets,
        "preprocess": req.preprocess.model_dump(),
        "augmentation": req.augmentation.model_dump(),
    }

    logger.info(
        "Training config updated",
        num_targets=req.num_targets,
        intensity=req.augmentation.intensity,
        n_per_target=req.augmentation.n_per_target,
        optional_steps=req.preprocess.optional_steps,
    )
    return {"status": "ok", "config": _current_config}


@router.get("/augmentation/presets")
def get_augmentation_presets():
    """증강 강도 프리셋 목록 + UI 라벨/설명 반환"""
    return {
        key: {
            "label": info["label"],
            "description": info["description"],
        }
        for key, info in INTENSITY_LABELS.items()
    }


@router.get("/preprocess/options")
def get_preprocess_options():
    """선택 전처리 항목 목록 + 필수 항목 정보 반환"""
    return FieldPreprocessor().get_info()


_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
_RAW_DIR = Path("artifacts/data/raw")
_MODEL_DIR = Path("artifacts/models")

# ── 학습 실행 상태 ────────────────────────────────────────────────────────────

_training_state: dict = {"status": "idle", "progress": 0, "message": "", "result": None}
_training_task: asyncio.Task | None = None


async def _broadcast(progress: int, message: str) -> None:
    from backend.api.websocket.manager import ws_manager
    _training_state.update({"progress": progress, "message": message})
    await ws_manager.broadcast("training", {
        "event": "progress",
        "status": "running",
        "progress": progress,
        "message": message,
    })


async def _run_training() -> None:
    from backend.api.websocket.manager import ws_manager
    from backend.models.registry import registry

    global _training_state
    _training_state = {"status": "running", "progress": 0, "message": "학습 준비 중...", "result": None}

    try:
        # Step 1: 이미지 로드
        await _broadcast(5, "학습 이미지 로드 중...")
        loop = asyncio.get_event_loop()

        def _load_images() -> dict[int, list[np.ndarray]]:
            target_images: dict[int, list[np.ndarray]] = {}
            for target_id in range(1, _current_config["num_targets"] + 1):
                target_dir = _RAW_DIR / f"T{target_id}"
                if not target_dir.exists():
                    continue
                imgs = []
                for f in sorted(target_dir.iterdir()):
                    if f.suffix.lower() in _ALLOWED_EXTS:
                        img = cv2.imread(str(f))
                        if img is not None:
                            imgs.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                if imgs:
                    target_images[target_id] = imgs
            return target_images

        target_images = await loop.run_in_executor(None, _load_images)

        if not target_images:
            raise ValueError(
                f"학습 이미지가 없습니다. 먼저 '학습 데이터 업로드'에서 T1~T{_current_config['num_targets']} 이미지를 업로드하세요."
            )

        total_raw = sum(len(v) for v in target_images.values())
        await _broadcast(15, f"{len(target_images)}개 타겟, 총 {total_raw}장 로드됨. 증강 중...")

        # Step 2: 증강 — 타겟별로 순차 처리 + 중간 broadcast
        # (한 번에 처리하면 Railway proxy 60초 타임아웃 내 WS 메시지 전송 불가)
        MAX_TOTAL = 1200
        n_per_target = min(
            _current_config["augmentation"]["n_per_target"],
            max(1, MAX_TOTAL // max(1, len(target_images))),
        )
        augmentor = FieldAugmentor.from_intensity(_current_config["augmentation"]["intensity"])
        all_images: list[np.ndarray] = []
        all_labels: list[int] = []
        sorted_targets = sorted(target_images.items())
        n_targets = len(sorted_targets)

        for step_i, (target_id, imgs) in enumerate(sorted_targets):
            def _augment_one(tid=target_id, raw_imgs=imgs) -> list[np.ndarray]:
                target_augmented: list[np.ndarray] = []
                raw_cycle = raw_imgs * (n_per_target // len(raw_imgs) + 1)
                for raw_img in raw_cycle[:n_per_target]:
                    n_each = max(1, n_per_target // len(raw_imgs))
                    target_augmented.extend(augmentor.generate(raw_img, n=n_each))
                    if len(target_augmented) >= n_per_target:
                        break
                return target_augmented[:n_per_target]

            augmented = await loop.run_in_executor(None, _augment_one)
            all_images.extend(augmented)
            all_labels.extend([target_id - 1] * len(augmented))

            pct = 15 + int((step_i + 1) / n_targets * 20)
            await _broadcast(pct, f"T{target_id} 증강 완료 ({len(augmented)}장). {'다음 타겟 처리 중...' if step_i + 1 < n_targets else 'Gate 학습 준비 중...'}")

        await _broadcast(35, f"증강 완료: {len(all_images)}장 ({n_targets}개 타겟 균형). Gate 모델 학습 중...")

        # Step 3: Gate 학습
        gate = registry.active_gate
        await loop.run_in_executor(None, gate.fit, all_images)
        await _broadcast(65, "Gate 학습 완료. Classifier 학습 중...")

        # Step 4: Gate 저장
        _MODEL_DIR.mkdir(parents=True, exist_ok=True)
        gate_path = _MODEL_DIR / "gate_a.pkl"
        await loop.run_in_executor(None, gate.save, gate_path)

        # Step 5: Classifier 학습 (functools.partial로 클로저 캡처 방지)
        clf = registry.active_classifier
        _fine_tune = functools.partial(
            clf.fine_tune, images=all_images, labels=all_labels, epochs=10
        )
        train_metrics = await loop.run_in_executor(None, _fine_tune)
        await _broadcast(90, "Classifier 학습 완료. 모델 저장 중...")

        # Step 6: Classifier 저장
        clf_path = _MODEL_DIR / "classifier.pth"
        await loop.run_in_executor(None, clf.save, clf_path)

        # Step 7: 파이프라인 재초기화 (학습된 모델 즉시 반영)
        from backend.main import reinit_pipeline
        await reinit_pipeline()

        # 완료
        _training_state.update({
            "status": "completed",
            "progress": 100,
            "message": f"학습 완료 — {len(all_images)}장 사용",
            "result": train_metrics,
        })
        await ws_manager.broadcast("training", {
            "event": "completed",
            "status": "completed",
            "progress": 100,
            "message": _training_state["message"],
            "result": train_metrics,
        })
        logger.info("Training completed", n_images=len(all_images))

    except Exception as e:
        _training_state.update({"status": "error", "message": str(e)})
        from backend.api.websocket.manager import ws_manager
        await ws_manager.broadcast("training", {
            "event": "error",
            "status": "error",
            "progress": _training_state["progress"],
            "message": str(e),
        })
        logger.error("Training failed", error=str(e), exc_info=True)


@router.post("/upload")
async def upload_training_images(
    target_id: int = Form(..., ge=1, le=20, description="타겟 번호 (1-based)"),
    files: list[UploadFile] = File(...),
):
    """타겟 학습 이미지 업로드 — artifacts/data/raw/T{target_id}/ 에 저장"""
    target_dir = _RAW_DIR / f"T{target_id}"
    target_dir.mkdir(parents=True, exist_ok=True)

    saved: list[str] = []
    skipped: list[str] = []

    for f in files:
        if not f.filename:
            continue
        # S-5: 경로 탐색 방지 — 파일명만 추출 (../ 등 제거)
        safe_name = Path(f.filename).name
        ext = Path(safe_name).suffix.lower()
        if ext not in _ALLOWED_EXTS:
            skipped.append(f.filename)
            continue
        content = await f.read()
        dest = target_dir / safe_name
        dest.write_bytes(content)
        saved.append(f.filename)

    logger.info("Training images uploaded", target_id=target_id, saved=len(saved), skipped=len(skipped))
    return {"target_id": target_id, "saved": len(saved), "skipped": skipped}


def _on_training_done(task: asyncio.Task) -> None:
    """태스크 완료 콜백 — 미수집 예외 로깅"""
    if not task.cancelled():
        exc = task.exception()
        if exc:
            logger.error("Training task raised unhandled exception", error=str(exc), exc_info=exc)
            _training_state.update({"status": "error", "message": str(exc)})


@router.post("/run")
async def run_training():
    """업로드된 이미지로 Gate + Classifier 학습 실행"""
    global _training_task
    if _training_state["status"] == "running":
        raise HTTPException(status_code=409, detail="이미 학습이 실행 중입니다. 완료 후 다시 시도하세요.")

    _training_task = asyncio.create_task(_run_training())
    _training_task.add_done_callback(_on_training_done)
    return {"status": "started", "message": "학습을 시작했습니다. /ws/training으로 진행 상황을 확인하세요."}


@router.get("/status")
def get_training_status():
    """현재 학습 상태 조회"""
    return _training_state


@router.get("/upload/stats")
def upload_stats():
    """각 타겟별 업로드된 이미지 수 반환"""
    result: dict[str, int] = {}
    if not _RAW_DIR.exists():
        return result
    for d in sorted(_RAW_DIR.iterdir()):
        if d.is_dir() and d.name.startswith("T"):
            count = sum(1 for f in d.iterdir() if f.suffix.lower() in _ALLOWED_EXTS)
            result[d.name] = count
    return result


@router.get("/images/{target_id}")
def list_target_images(target_id: int):
    """타겟별 업로드된 이미지 파일명 목록 반환"""
    target_dir = _RAW_DIR / f"T{target_id}"
    if not target_dir.exists():
        return {"images": []}
    images = sorted(
        f.name for f in target_dir.iterdir()
        if f.suffix.lower() in _ALLOWED_EXTS
    )
    return {"images": images}


@router.get("/images/{target_id}/{filename}")
def get_target_image(target_id: int, filename: str):
    """타겟 이미지 파일 서빙"""
    safe_name = Path(filename).name  # 경로 탐색 방지
    image_path = _RAW_DIR / f"T{target_id}" / safe_name
    if not image_path.exists() or image_path.suffix.lower() not in _ALLOWED_EXTS:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    return FileResponse(str(image_path))


@router.post("/reset")
async def reset_training(keep_images: bool = True):
    """
    학습 데이터 + 모델 파일 초기화 (모델 전환 시 사용)
    keep_images=True : 원본 타겟 이미지는 유지 (기본값)
    keep_images=False: 원본 이미지까지 전부 삭제
    """
    import shutil
    from backend.models.registry import registry
    from backend.main import reinit_pipeline

    # 진행 중인 학습이 있으면 거부
    global _training_task
    if _training_task and not _training_task.done():
        raise HTTPException(status_code=409, detail="학습이 진행 중입니다. 완료 후 초기화하세요.")

    removed: list[str] = []

    # 1. 모델 파일 삭제
    for p in [_MODEL_DIR / "gate_a.pkl", _MODEL_DIR / "classifier.pth",
              _MODEL_DIR / "gate", _MODEL_DIR / "classifier"]:
        if p.exists():
            shutil.rmtree(p) if p.is_dir() else p.unlink()
            removed.append(str(p))

    # 2. 학습/AL 파생 데이터 삭제 (labeled, al_queue)
    for d in [Path("artifacts/data/labeled"), Path("artifacts/data/al_queue")]:
        if d.exists():
            shutil.rmtree(d)
            d.mkdir(parents=True)
            removed.append(str(d))

    # 3. 원본 이미지 삭제 (선택)
    if not keep_images:
        raw_dir = Path("artifacts/data/raw")
        for target_dir in raw_dir.iterdir():
            if target_dir.is_dir():
                shutil.rmtree(target_dir)
                target_dir.mkdir()
        removed.append(str(raw_dir))

    # 4. 메모리의 모델도 미학습 상태로 교체
    new_gate = registry.create_gate(settings.gate_model)
    new_clf = registry.create_classifier(backbone=settings.classifier_backbone)
    registry.register_gate("gate_a", new_gate)
    registry.register_classifier("classifier", new_clf)
    await reinit_pipeline()

    logger.info("Training data reset", kept_images=keep_images, removed=removed)
    return {"status": "reset", "kept_images": keep_images, "removed": removed}


@router.delete("/images/{target_id}/{filename}")
def delete_target_image(target_id: int, filename: str):
    """타겟 이미지 삭제"""
    safe_name = Path(filename).name  # 경로 탐색 방지
    image_path = _RAW_DIR / f"T{target_id}" / safe_name
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    image_path.unlink()
    logger.info("Training image deleted", target_id=target_id, filename=safe_name)
    return {"deleted": safe_name}
