"""
현장 카메라 환경을 시뮬레이션하는 증강 파이프라인
가우시안 블러, Poisson 노이즈, 밝기/명암, 광원이동/글레어,
원근왜곡, 모션블러, 모자이크/해상도저하

강도(Intensity) 프리셋:
  weak          → 약    : 원본과 거의 동일, 미세한 변화만
  medium_weak   → 중약  : 눈에 살짝 띄는 수준의 변형
  medium        → 중    : 실제 현장 수준의 표준 변형
  medium_strong → 중강  : 어두운 조명·손 떨림·노이즈가 뚜렷한 수준
  strong        → 강    : 강한 왜곡, 원본 구분이 어려운 수준
  extreme       → 최강  : 현장 최악 조건 시뮬레이션
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable

import albumentations as A
import cv2
import numpy as np
from PIL import Image


# ── 강도 프리셋 정의 ───────────────────────────────────────────────────────

@dataclass
class AugParams:
    """증강 파라미터 집합"""
    blur_prob: float
    noise_prob: float
    brightness_prob: float
    glare_prob: float
    perspective_prob: float
    motion_blur_prob: float
    mosaic_prob: float
    perspective_scale: tuple[float, float]
    brightness_limit: tuple[float, float]
    blur_limit: tuple[int, int]
    rotate_limit: int


INTENSITY_PRESETS: dict[str, AugParams] = {
    "weak": AugParams(
        blur_prob=0.1,
        noise_prob=0.1,
        brightness_prob=0.2,
        glare_prob=0.1,
        perspective_prob=0.1,
        motion_blur_prob=0.05,
        mosaic_prob=0.05,
        perspective_scale=(0.01, 0.03),
        brightness_limit=(-0.1, 0.1),
        blur_limit=(3, 5),
        rotate_limit=3,
    ),
    "medium_weak": AugParams(
        blur_prob=0.25,
        noise_prob=0.25,
        brightness_prob=0.4,
        glare_prob=0.2,
        perspective_prob=0.25,
        motion_blur_prob=0.15,
        mosaic_prob=0.15,
        perspective_scale=(0.01, 0.06),
        brightness_limit=(-0.2, 0.2),
        blur_limit=(3, 7),
        rotate_limit=8,
    ),
    "medium": AugParams(
        blur_prob=0.4,
        noise_prob=0.4,
        brightness_prob=0.6,
        glare_prob=0.3,
        perspective_prob=0.4,
        motion_blur_prob=0.25,
        mosaic_prob=0.25,
        perspective_scale=(0.02, 0.09),
        brightness_limit=(-0.3, 0.3),
        blur_limit=(3, 11),
        rotate_limit=15,
    ),
    "medium_strong": AugParams(
        blur_prob=0.55,
        noise_prob=0.55,
        brightness_prob=0.75,
        glare_prob=0.45,
        perspective_prob=0.55,
        motion_blur_prob=0.40,
        mosaic_prob=0.40,
        perspective_scale=(0.03, 0.12),
        brightness_limit=(-0.4, 0.4),
        blur_limit=(3, 13),
        rotate_limit=25,
    ),
    "strong": AugParams(
        blur_prob=0.70,
        noise_prob=0.70,
        brightness_prob=0.85,
        glare_prob=0.60,
        perspective_prob=0.70,
        motion_blur_prob=0.55,
        mosaic_prob=0.55,
        perspective_scale=(0.05, 0.15),
        brightness_limit=(-0.5, 0.5),
        blur_limit=(3, 15),
        rotate_limit=35,
    ),
    "extreme": AugParams(
        blur_prob=0.85,
        noise_prob=0.85,
        brightness_prob=0.95,
        glare_prob=0.75,
        perspective_prob=0.85,
        motion_blur_prob=0.70,
        mosaic_prob=0.70,
        perspective_scale=(0.07, 0.20),
        brightness_limit=(-0.6, 0.6),
        blur_limit=(3, 19),
        rotate_limit=45,
    ),
}

# UI 표시용 강도 레이블 및 설명
INTENSITY_LABELS: dict[str, dict] = {
    "weak":          {"label": "약",   "description": "원본과 거의 같음 — 밝기·각도 아주 미세하게만 변화"},
    "medium_weak":   {"label": "중약", "description": "살짝 달라 보이는 수준 — 조명과 각도 변화가 눈에 조금 띔"},
    "medium":        {"label": "중",   "description": "실제 현장 수준 — 조명·각도·노이즈가 표준적으로 섞임"},
    "medium_strong": {"label": "중강", "description": "뚜렷한 변형 — 어두운 조명, 손 떨림, 노이즈가 확실히 보임"},
    "strong":        {"label": "강",   "description": "심한 왜곡 — 블러·노이즈·원근 변형이 강해 원본 구분이 어려움"},
    "extreme":       {"label": "최강", "description": "극단적 변형 — 현장 최악 조건 시뮬레이션, 거의 원본과 다름"},
}


class FieldAugmentor:
    """
    산업 현장 카메라 환경 시뮬레이션 증강기

    각 증강 기법이 독립적으로 설정 가능하며,
    Target 이미지 1개에서 수백~수천 장 생성 가능.

    사용 예시:
        # 강도 프리셋으로 생성
        augmentor = FieldAugmentor.from_intensity("medium")

        # 직접 파라미터로 생성 (기존 방식)
        augmentor = FieldAugmentor(blur_prob=0.4, ...)
    """

    def __init__(
        self,
        blur_prob: float = 0.4,
        noise_prob: float = 0.4,
        brightness_prob: float = 0.6,
        glare_prob: float = 0.3,
        perspective_prob: float = 0.4,
        motion_blur_prob: float = 0.25,
        mosaic_prob: float = 0.25,
        perspective_scale: tuple[float, float] = (0.02, 0.09),
        brightness_limit: tuple[float, float] = (-0.3, 0.3),
        blur_limit: tuple[int, int] = (3, 11),
        rotate_limit: int = 15,
        output_size: tuple[int, int] = (224, 224),
    ) -> None:
        self.output_size = output_size
        self._glare_prob = glare_prob
        self._params = AugParams(
            blur_prob=blur_prob,
            noise_prob=noise_prob,
            brightness_prob=brightness_prob,
            glare_prob=glare_prob,
            perspective_prob=perspective_prob,
            motion_blur_prob=motion_blur_prob,
            mosaic_prob=mosaic_prob,
            perspective_scale=perspective_scale,
            brightness_limit=brightness_limit,
            blur_limit=blur_limit,
            rotate_limit=rotate_limit,
        )
        self._pipeline = self._build_pipeline(self._params)

    @classmethod
    def from_intensity(
        cls,
        intensity: str,
        output_size: tuple[int, int] = (224, 224),
    ) -> "FieldAugmentor":
        """
        강도 프리셋으로 증강기 생성

        Args:
            intensity: "weak" | "medium_weak" | "medium" | "medium_strong" | "strong" | "extreme"
            output_size: 출력 이미지 크기

        Returns:
            설정된 FieldAugmentor 인스턴스
        """
        if intensity not in INTENSITY_PRESETS:
            valid = list(INTENSITY_PRESETS.keys())
            raise ValueError(f"Unknown intensity: {intensity!r}. Valid: {valid}")
        p = INTENSITY_PRESETS[intensity]
        return cls(
            blur_prob=p.blur_prob,
            noise_prob=p.noise_prob,
            brightness_prob=p.brightness_prob,
            glare_prob=p.glare_prob,
            perspective_prob=p.perspective_prob,
            motion_blur_prob=p.motion_blur_prob,
            mosaic_prob=p.mosaic_prob,
            perspective_scale=p.perspective_scale,
            brightness_limit=p.brightness_limit,
            blur_limit=p.blur_limit,
            rotate_limit=p.rotate_limit,
            output_size=output_size,
        )

    def _build_pipeline(self, p: AugParams) -> A.Compose:
        transforms = [
            # 1. 가우시안 블러 — 초점 미스 시뮬레이션
            A.GaussianBlur(
                blur_limit=p.blur_limit,
                p=p.blur_prob,
            ),

            # 2. Poisson/가우시안 노이즈 — 카메라 센서 노이즈
            A.OneOf([
                A.GaussNoise(std_range=(0.01, 0.05), p=1.0),
                A.ISONoise(color_shift=(0.01, 0.05), intensity=(0.1, 0.5), p=1.0),
            ], p=p.noise_prob),

            # 3. 밝기/명암 변화 — 조명 환경 변화
            A.OneOf([
                A.RandomBrightnessContrast(
                    brightness_limit=p.brightness_limit,
                    contrast_limit=(p.brightness_limit[0] * 0.7, p.brightness_limit[1] * 0.7),
                    p=1.0,
                ),
                A.CLAHE(clip_limit=4.0, p=1.0),
                A.RandomGamma(gamma_limit=(60, 140), p=1.0),
            ], p=p.brightness_prob),

            # 4. 원근 왜곡 — 비스듬한 각도 촬영
            A.Perspective(
                scale=p.perspective_scale,
                keep_size=True,
                p=p.perspective_prob,
            ),

            # 5. 모션 블러 — 손 떨림
            A.MotionBlur(
                blur_limit=p.blur_limit,
                p=p.motion_blur_prob,
            ),

            # 6. 해상도 저하 — 원거리 촬영
            A.Downscale(
                scale_range=(0.4, 0.9),
                p=p.mosaic_prob,
            ),

            # 7. 기본 기하학적 변환
            A.HorizontalFlip(p=0.2),
            A.ShiftScaleRotate(
                shift_limit=0.05,
                scale_limit=0.1,
                rotate_limit=p.rotate_limit,
                p=0.4,
            ),

            # 8. 최종 리사이즈
            A.Resize(*self.output_size),
        ]
        return A.Compose(transforms)

    def _add_glare(self, image: np.ndarray) -> np.ndarray:
        """
        광원 이동/글레어 시뮬레이션
        albumentations에 없어서 직접 구현
        """
        if random.random() > self._glare_prob:
            return image

        h, w = image.shape[:2]
        result = image.copy().astype(np.float32)

        center_x = random.randint(0, w)
        center_y = random.randint(0, h)
        radius = random.randint(w // 6, w // 2)
        intensity = random.uniform(0.3, 0.8)

        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt((X - center_x) ** 2 + (Y - center_y) ** 2)
        mask = np.exp(-dist / radius) * intensity

        for c in range(3):
            result[:, :, c] = np.clip(result[:, :, c] + mask * 255, 0, 255)

        return result.astype(np.uint8)

    def augment(self, image: np.ndarray) -> np.ndarray:
        """단일 이미지 증강 (RGB numpy)"""
        img = self._add_glare(image)
        result = self._pipeline(image=img)["image"]
        return result

    def generate(self, image: np.ndarray, n: int = 500) -> list[np.ndarray]:
        """
        단일 Target 이미지에서 n장의 증강 이미지 생성

        Args:
            image: 원본 Target 이미지 (RGB numpy)
            n: 생성할 증강 이미지 수

        Returns:
            증강된 이미지 리스트 (원본 1장 포함)
        """
        augmented: list[np.ndarray] = []
        # 원본도 포함 (리사이즈만 적용)
        original = cv2.resize(image, self.output_size[::-1])
        augmented.append(original)

        for _ in range(n - 1):
            aug = self.augment(image)
            augmented.append(aug)

        return augmented

    def generate_all_targets(
        self,
        target_images: dict[int, np.ndarray],
        n_per_target: int = 500,
    ) -> tuple[list[np.ndarray], list[int]]:
        """
        Target 이미지 딕셔너리에서 전체 증강 데이터셋 생성
        타겟 수 제한 없음 — target_images 딕셔너리에 맞춰 자동 처리

        Args:
            target_images: {target_id(1~N): image_array}
            n_per_target: Target 1개당 생성할 수

        Returns:
            (images, labels) 튜플 (label은 0-indexed)
        """
        all_images: list[np.ndarray] = []
        all_labels: list[int] = []

        for target_id, image in sorted(target_images.items()):
            aug_images = self.generate(image, n=n_per_target)
            all_images.extend(aug_images)
            all_labels.extend([target_id - 1] * len(aug_images))  # 0-indexed

        return all_images, all_labels
