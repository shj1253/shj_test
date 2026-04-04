"""
학습 설정 API — 타겟 수, 전처리, 증강 설정 관리
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from backend.config import settings
from backend.data.augmentation import INTENSITY_LABELS, INTENSITY_PRESETS
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
        ext = Path(f.filename).suffix.lower()
        if ext not in _ALLOWED_EXTS:
            skipped.append(f.filename)
            continue
        content = await f.read()
        dest = target_dir / f.filename
        dest.write_bytes(content)
        saved.append(f.filename)

    logger.info("Training images uploaded", target_id=target_id, saved=len(saved), skipped=len(skipped))
    return {"target_id": target_id, "saved": len(saved), "skipped": skipped}


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
