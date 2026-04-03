"""
Core-set 샘플링 — 재학습 전 수집 편향 방지
Feature 공간에서 커버리지가 낮은 영역의 샘플을 우선 선택
"""
from __future__ import annotations

import numpy as np
from sklearn.metrics.pairwise import euclidean_distances


class CoreSetSampler:
    """
    Greedy Core-set 알고리즘

    원리:
    1. 이미 레이블된 샘플의 Feature 공간 분포 파악
    2. 레이블되지 않은 후보 샘플 중 "가장 멀리 떨어진 것"을 반복 선택
    3. budget 만큼 선택하면 종료

    역할:
    - AL 큐 A+B를 합산한 풀에서 다양성 보장
    - 특정 영역에 수집이 편향되는 것을 방지
    - 배치 처리로만 사용 (실시간 아님)
    """

    def select(
        self,
        candidate_features: np.ndarray,   # [N, D] 후보 샘플 피처
        labeled_features: np.ndarray | None,  # [M, D] 이미 레이블된 샘플 피처
        budget: int,
    ) -> list[int]:
        """
        Greedy Core-set으로 budget 개 샘플 인덱스 반환

        Args:
            candidate_features: 선택 후보 피처 행렬
            labeled_features: 기존 레이블 샘플 피처 (없으면 None)
            budget: 최대 선택 개수

        Returns:
            선택된 후보 인덱스 리스트
        """
        candidate_features = np.array(candidate_features, dtype=np.float32)
        n = len(candidate_features)
        budget = min(budget, n)

        if labeled_features is None or len(labeled_features) == 0:
            # 레이블 없으면 최대 분산 기준 균등 선택
            return self._farthest_first(candidate_features, budget)

        labeled_features = np.array(labeled_features, dtype=np.float32)

        # 각 후보와 레이블 샘플 간 최소 거리 계산
        dists = euclidean_distances(candidate_features, labeled_features)
        min_dists = dists.min(axis=1)  # [N]

        selected: list[int] = []
        all_features = candidate_features.copy()

        for _ in range(budget):
            if len(selected) == 0:
                # 첫 번째: 레이블과 가장 먼 것 선택
                idx = int(np.argmax(min_dists))
            else:
                # 이후: 선택된 것들과도 가장 먼 것
                selected_feats = all_features[selected]
                d_to_selected = euclidean_distances(
                    candidate_features, selected_feats
                ).min(axis=1)
                # 레이블과의 거리와 선택된 것과의 거리 중 최소
                combined = np.minimum(min_dists, d_to_selected)
                idx = int(np.argmax(combined))

            selected.append(idx)
            # 선택된 것의 거리를 0으로 업데이트 (다시 선택 안 되도록)
            min_dists[idx] = 0.0

        return selected

    def _farthest_first(self, features: np.ndarray, budget: int) -> list[int]:
        """레이블이 없을 때 최대 분산으로 분산 선택"""
        features = np.array(features, dtype=np.float32)
        selected = [int(np.random.randint(0, len(features)))]
        for _ in range(1, budget):
            dists = euclidean_distances(
                features, features[selected]
            ).min(axis=1)
            dists[selected] = 0.0
            selected.append(int(np.argmax(dists)))
        return selected
