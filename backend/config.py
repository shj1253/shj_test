"""
전역 설정 관리 — pydantic-settings 기반
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        protected_namespaces=(),  # 'model_' 네임스페이스 충돌 경고 제거
    )

    # ── Server ──────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    # CORS — 쉼표로 여러 도메인 허용 (예: "https://cannon.vercel.app,http://localhost:5173")
    allowed_origins: str = "*"

    # ── Model ───────────────────────────────────────────────────────
    gate_model: Literal["patchcore", "efficientnet"] = "patchcore"
    gate_backbone: str = "resnet18"
    efficientnet_variant: str = "b3"
    classifier_backbone: Literal["resnet18", "resnet34", "resnet50"] = "resnet50"
    num_targets: int = 4

    # ── Paths ───────────────────────────────────────────────────────
    artifacts_dir: Path = Path("artifacts")
    target_images_dir: Path = Path("artifacts/data/raw")
    labeled_data_dir: Path = Path("artifacts/data/labeled")
    al_queue_dir: Path = Path("artifacts/data/al_queue")
    model_save_dir: Path = Path("artifacts/models")

    # ── Gate Thresholds ─────────────────────────────────────────────
    gate_in_threshold: float = Field(0.5, ge=0.0, le=1.0)
    gate_margin_low: float = Field(0.5, ge=0.0, le=1.0)
    gate_margin_high: float = Field(0.8, ge=0.0, le=1.0)

    # ── Classify Thresholds ─────────────────────────────────────────
    uncertainty_threshold: float = Field(0.7, ge=0.0, le=1.0)
    margin_threshold: float = Field(0.2, ge=0.0, le=1.0)

    # ── Active Learning ─────────────────────────────────────────────
    al_queue_max_size: int = 1000
    al_batch_budget: int = 50

    # ── Camera ──────────────────────────────────────────────────────
    camera_device_id: int = 0
    camera_fps: int = 30
    camera_width: int = 1280
    camera_height: int = 720

    # ── Preprocessing ────────────────────────────────────────────────
    # 선택 전처리 (쉼표 구분 문자열, 예: "clahe,denoise")
    preprocess_optional: str = "pad_square"

    # ── Augmentation ─────────────────────────────────────────────────
    aug_intensity: str = "medium"          # weak|medium_weak|medium|medium_strong|strong|extreme
    aug_n_per_target: int = 500            # 타겟당 증강 수

    # ── Metrics ─────────────────────────────────────────────────────
    metrics_window_size: int = 100

    @field_validator("gate_margin_high")
    @classmethod
    def margin_high_gt_low(cls, v: float, info) -> float:
        low = info.data.get("gate_margin_low", 0.5)
        if v <= low:
            raise ValueError("gate_margin_high must be > gate_margin_low")
        return v

    def ensure_dirs(self) -> None:
        """필요한 디렉터리를 모두 생성"""
        for d in [
            self.artifacts_dir,
            self.target_images_dir,
            self.labeled_data_dir,
            self.al_queue_dir,
            self.model_save_dir / "gate",
            self.model_save_dir / "classifier",
        ]:
            d.mkdir(parents=True, exist_ok=True)


# 싱글턴 인스턴스
settings = Settings()
