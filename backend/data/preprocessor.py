"""
현장 이미지 전처리 모듈

필수 전처리 (Mandatory) — 항상 적용, 모델 정상 동작에 필수:
  1. to_rgb       : RGBA/그레이스케일 → RGB 변환 (채널 수 통일)
  2. resize       : 모델 입력 크기 통일 (기본 224×224)
  3. normalize    : ImageNet mean/std 정규화 (사전학습 가중치 기준)

선택 전처리 (Optional) — 현장 환경에 따라 골라서 적용:
  1. clahe        : 조명 불균일 보정 — 어두운/밝기 차이 심한 현장
  2. denoise      : 카메라 노이즈 제거 — 저가 카메라, 먼지·진동 환경
  3. sharpen      : 경계 선명화 — 초점이 약하거나 흐린 이미지
  4. pad_square   : 정방형 패딩 — 원본 비율 왜곡 없이 리사이즈 필요 시
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import cv2
import numpy as np
import torch
import torchvision.transforms.functional as TF
from PIL import Image


# ── 선택 전처리 메타데이터 ─────────────────────────────────────────────────

OPTIONAL_STEPS: dict[str, dict] = {
    "clahe": {
        "label": "CLAHE 조명 보정",
        "description": "조명이 불균일하거나 너무 어두운 현장에서 효과적",
        "default": False,
    },
    "denoise": {
        "label": "노이즈 제거",
        "description": "저가 카메라나 진동·먼지 환경에서 센서 잡음 제거",
        "default": False,
    },
    "sharpen": {
        "label": "경계 선명화",
        "description": "초점이 약한 이미지에서 윤곽선을 뚜렷하게 강화",
        "default": False,
    },
    "pad_square": {
        "label": "비율 보존 패딩",
        "description": "원본 비율 왜곡 없이 정방형으로 패딩 후 리사이즈",
        "default": True,
    },
}

# ImageNet 기준 (사전학습 모델 정규화)
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD  = [0.229, 0.224, 0.225]


@dataclass
class PreprocessConfig:
    """
    전처리 설정

    Attributes:
        input_size: 모델 입력 크기 (H, W)
        optional_steps: 적용할 선택 전처리 목록 (e.g. ["clahe", "pad_square"])
        clahe_clip_limit: CLAHE clip limit (기본 2.0)
        clahe_tile_grid: CLAHE 타일 크기
        denoise_h: 노이즈 제거 강도 (높을수록 강함, 기본 10)
        sharpen_amount: 선명화 강도 (0.0~2.0, 기본 1.0)
    """
    input_size: tuple[int, int] = (224, 224)
    optional_steps: list[str] = field(default_factory=lambda: ["pad_square"])
    clahe_clip_limit: float = 2.0
    clahe_tile_grid: tuple[int, int] = (8, 8)
    denoise_h: int = 10
    sharpen_amount: float = 1.0

    def to_dict(self) -> dict:
        return {
            "input_size": list(self.input_size),
            "optional_steps": self.optional_steps,
            "clahe_clip_limit": self.clahe_clip_limit,
            "clahe_tile_grid": list(self.clahe_tile_grid),
            "denoise_h": self.denoise_h,
            "sharpen_amount": self.sharpen_amount,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PreprocessConfig":
        d = dict(d)
        if "input_size" in d:
            d["input_size"] = tuple(d["input_size"])
        if "clahe_tile_grid" in d:
            d["clahe_tile_grid"] = tuple(d["clahe_tile_grid"])
        return cls(**d)


class FieldPreprocessor:
    """
    현장 이미지 전처리기

    사용 예시:
        preprocessor = FieldPreprocessor(PreprocessConfig(
            optional_steps=["clahe", "denoise"]
        ))
        tensor = preprocessor.preprocess_to_tensor(image)   # 모델 입력용
        array = preprocessor.preprocess_to_array(image)     # 증강 파이프라인 입력용
    """

    # 필수 전처리 (UI에서 항상 ON, 비활성화 불가)
    MANDATORY_STEPS: list[dict] = [
        {
            "id": "to_rgb",
            "label": "RGB 변환",
            "description": "RGBA·그레이스케일 등 비표준 채널을 RGB로 통일",
        },
        {
            "id": "resize",
            "label": "크기 정규화",
            "description": "모델 입력 크기(224×224)로 통일 — 일관된 추론 필수",
        },
        {
            "id": "normalize",
            "label": "픽셀 정규화",
            "description": "ImageNet mean/std 기준 정규화 — 사전학습 가중치 활용 필수",
        },
    ]

    def __init__(self, config: PreprocessConfig | None = None) -> None:
        self.config = config or PreprocessConfig()
        self._clahe_obj = cv2.createCLAHE(
            clipLimit=self.config.clahe_clip_limit,
            tileGridSize=self.config.clahe_tile_grid,
        )

    # ── 내부 단계별 처리 ──────────────────────────────────────────────────

    def _to_rgb(self, image: np.ndarray) -> np.ndarray:
        """RGBA, 그레이스케일 → RGB (3채널)"""
        if image.ndim == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        if image.shape[2] == 4:
            return cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
        if image.shape[2] == 1:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        return image  # 이미 RGB

    def _pad_square(self, image: np.ndarray) -> np.ndarray:
        """비율 보존 — 짧은 변을 검정(0)으로 패딩하여 정방형 만들기"""
        h, w = image.shape[:2]
        if h == w:
            return image
        size = max(h, w)
        result = np.zeros((size, size, 3), dtype=np.uint8)
        y_off = (size - h) // 2
        x_off = (size - w) // 2
        result[y_off:y_off + h, x_off:x_off + w] = image
        return result

    def _clahe(self, image: np.ndarray) -> np.ndarray:
        """CLAHE 조명 균일화 (LAB 색공간에서 L채널에만 적용)"""
        lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)
        l_eq = self._clahe_obj.apply(l)
        lab_eq = cv2.merge([l_eq, a, b])
        return cv2.cvtColor(lab_eq, cv2.COLOR_LAB2RGB)

    def _denoise(self, image: np.ndarray) -> np.ndarray:
        """Bilateral filter 기반 노이즈 제거 (경계선 보존)"""
        # NLM denoising — 컬러 이미지에 직접 적용
        bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        denoised = cv2.fastNlMeansDenoisingColored(
            bgr,
            h=self.config.denoise_h,
            hColor=self.config.denoise_h,
            templateWindowSize=7,
            searchWindowSize=21,
        )
        return cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB)

    def _sharpen(self, image: np.ndarray) -> np.ndarray:
        """Unsharp masking 선명화"""
        amt = self.config.sharpen_amount
        blurred = cv2.GaussianBlur(image, (0, 0), 3)
        sharpened = cv2.addWeighted(image, 1 + amt, blurred, -amt, 0)
        return np.clip(sharpened, 0, 255).astype(np.uint8)

    def _resize(self, image: np.ndarray) -> np.ndarray:
        h, w = self.config.input_size
        return cv2.resize(image, (w, h), interpolation=cv2.INTER_LINEAR)

    # ── 공개 API ──────────────────────────────────────────────────────────

    def preprocess_to_array(self, image: np.ndarray) -> np.ndarray:
        """
        전처리 후 uint8 numpy 배열 반환 (증강 파이프라인 입력용)
        정규화(normalize)는 증강 후 tensor 변환 시 적용하므로 여기선 제외.
        """
        img = self._to_rgb(image)

        for step in self.config.optional_steps:
            if step == "pad_square":
                img = self._pad_square(img)
            elif step == "clahe":
                img = self._clahe(img)
            elif step == "denoise":
                img = self._denoise(img)
            elif step == "sharpen":
                img = self._sharpen(img)

        img = self._resize(img)
        return img

    def preprocess_to_tensor(self, image: np.ndarray) -> torch.Tensor:
        """
        전처리 후 정규화된 tensor 반환 (모델 추론 직접 입력용)
        Shape: [3, H, W], dtype: float32
        """
        img = self.preprocess_to_array(image)

        # numpy uint8 → PIL → tensor → normalize
        pil = Image.fromarray(img)
        tensor = TF.to_tensor(pil)  # [3, H, W], float32, 0~1
        tensor = TF.normalize(tensor, mean=_IMAGENET_MEAN, std=_IMAGENET_STD)
        return tensor

    def get_info(self) -> dict:
        """현재 전처리 설정 정보 반환 (UI 표시용)"""
        return {
            "mandatory": self.MANDATORY_STEPS,
            "optional_available": OPTIONAL_STEPS,
            "optional_active": self.config.optional_steps,
            "config": self.config.to_dict(),
        }
