"""
거리 기반 샘플링 — Gate AL 후보 선별
Gate에서 이미 계산한 normalized_score를 재활용 (추가 연산 없음)
"""
from __future__ import annotations

import numpy as np

from backend.models.base import GateResult


class DistanceBasedSampler:
    """
    Gate 마진 구간 샘플 수집기

    Gate가 이미 클러스터 거리를 계산하기 때문에
    in_margin 플래그만 확인하면 됨 → 추가 비용 없음.
    """

    def __init__(
        self,
        margin_low: float = 0.5,
        margin_high: float = 0.8,
    ) -> None:
        self.margin_low = margin_low
        self.margin_high = margin_high

    def should_collect(self, gate_result: GateResult) -> bool:
        """이 프레임을 AL 큐 A에 넣어야 하는지 판단"""
        return gate_result.in_margin

    def score(self, gate_result: GateResult) -> float:
        """
        AL 우선순위 점수:
        경계 중심에 가까울수록 높음 (마진 구간 중점 기준)
        """
        mid = (self.margin_low + self.margin_high) / 2
        return 1.0 - abs(gate_result.normalized_score - mid)
