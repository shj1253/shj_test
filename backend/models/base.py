"""
Gate / Classifier 모델 추상 기반 클래스
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


# ── 공통 결과 타입 ──────────────────────────────────────────────────────────

@dataclass
class GateResult:
    is_target: bool              # True → Classify 단계로 진행
    score: float                 # 이상 점수 (높을수록 OOD)
    normalized_score: float      # 0~1 정규화 점수
    in_margin: bool              # True → AL 수집 후보 (경계 구간)
    model_name: str              # 어떤 Gate 모델이 판단했는지
    latency_ms: float = 0.0


@dataclass
class ClassifyResult:
    target_id: int               # 1~4 (0은 미판정)
    confidence: float            # 1등 확률
    probabilities: list[float]   # [T1, T2, T3, T4] softmax 확률
    is_uncertain: bool           # True → AL 큐 후보
    margin: float                # 1등·2등 확률 차이
    model_name: str
    latency_ms: float = 0.0


# ── Gate 추상 클래스 ─────────────────────────────────────────────────────────

class BaseGateModel(ABC):
    """1단 Gate: OOD vs In-Distribution 판별"""

    def __init__(self, name: str) -> None:
        self.name = name
        self._is_loaded: bool = False

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @abstractmethod
    def fit(self, normal_images: list[np.ndarray]) -> None:
        """정상(In-distribution) 이미지로 분포 구축"""

    @abstractmethod
    def predict(self, frame: np.ndarray) -> GateResult:
        """단일 프레임에 대해 OOD 판별"""

    @abstractmethod
    def predict_batch(self, frames: list[np.ndarray]) -> list[GateResult]:
        """배치 추론 (벤치마크 / 평가용)"""

    @abstractmethod
    def update(self, new_samples: list[np.ndarray]) -> None:
        """AL로 수집된 샘플을 분포에 추가 (incremental)"""

    @abstractmethod
    def load(self, path: Path) -> None:
        """저장된 가중치/메모리 뱅크 로드"""

    @abstractmethod
    def save(self, path: Path) -> None:
        """가중치/메모리 뱅크 저장"""

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r}, loaded={self._is_loaded})"


# ── Classifier 추상 클래스 ───────────────────────────────────────────────────

class BaseClassifierModel(ABC):
    """2단 Classify: T1/T2/T3/T4 분류"""

    def __init__(self, name: str, num_classes: int = 4) -> None:
        self.name = name
        self.num_classes = num_classes
        self._is_loaded: bool = False

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @abstractmethod
    def predict(self, frame: np.ndarray) -> ClassifyResult:
        """단일 프레임 분류"""

    @abstractmethod
    def predict_batch(self, frames: list[np.ndarray]) -> list[ClassifyResult]:
        """배치 분류 (벤치마크 / 평가용)"""

    @abstractmethod
    def predict_proba(self, frame: np.ndarray) -> np.ndarray:
        """softmax 확률 벡터만 반환 (shape: [num_classes])"""

    @abstractmethod
    def fine_tune(
        self,
        images: list[np.ndarray],
        labels: list[int],
        epochs: int = 5,
    ) -> dict[str, float]:
        """AL 레이블 데이터로 fine-tuning, 학습 지표 반환"""

    @abstractmethod
    def load(self, path: Path) -> None: ...

    @abstractmethod
    def save(self, path: Path) -> None: ...

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r}, loaded={self._is_loaded})"
