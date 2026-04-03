"""
Margin Sampling — Uncertainty 통과 샘플 내 우선순위 정렬
1등·2등 확률 차이가 작을수록 우선순위 높음
"""
from __future__ import annotations

import numpy as np

from backend.models.base import ClassifyResult


class MarginSampler:
    """
    1등·2등 확률 차이(Margin) 기반 우선순위 정렬

    - Uncertainty Sampling 이후 적용
    - 별도 임계값 없음 — 정렬 기준으로만 사용
    - 4클래스 환경에서 Entropy와 거의 동일하므로 Margin 선택
    """

    def margin_score(self, result: ClassifyResult) -> float:
        """
        Margin 점수 (낮을수록 더 위험 → 우선 라벨링):
        result.margin = confidence[1st] - confidence[2nd]
        """
        return result.margin

    def sort_by_priority(
        self, results: list[ClassifyResult]
    ) -> list[tuple[int, ClassifyResult]]:
        """
        (원래 인덱스, 결과) 튜플 리스트를 margin 오름차순 정렬
        margin이 작은 것이 앞에 (더 위험)
        """
        indexed = list(enumerate(results))
        indexed.sort(key=lambda x: self.margin_score(x[1]))
        return indexed

    def priority_score(self, result: ClassifyResult) -> float:
        """
        우선순위 점수 (높을수록 우선 라벨링):
        1.0 - margin (margin이 작을수록 높음)
        """
        return 1.0 - min(result.margin, 1.0)
