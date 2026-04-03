"""
Uncertainty Sampling — Classify AL 후보 1차 필터
1등 확률 < 임계값이면 불확실 샘플로 판정
"""
from __future__ import annotations

import numpy as np

from backend.models.base import ClassifyResult


class UncertaintySampler:
    """
    1등 확률(max probability) 기반 불확실성 필터

    - 구현 단순: max(probs) < threshold
    - Classify 단계 1차 필터로 사용
    """

    def __init__(self, threshold: float = 0.7) -> None:
        self.threshold = threshold

    def is_uncertain(self, result: ClassifyResult) -> bool:
        """불확실 여부 판단"""
        return result.confidence < self.threshold

    def uncertainty_score(self, result: ClassifyResult) -> float:
        """
        불확실성 점수 (높을수록 불확실):
        1.0 - confidence
        """
        return 1.0 - result.confidence
