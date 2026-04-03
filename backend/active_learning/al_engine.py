"""
Active Learning 엔진 — 샘플 수집 / 배치 구성 / 재학습 트리거
"""
from __future__ import annotations

import uuid
from pathlib import Path

import numpy as np

from backend.active_learning.labeling_queue import ALSample, LabelingQueue
from backend.active_learning.sampling.coreset import CoreSetSampler
from backend.active_learning.sampling.distance_based import DistanceBasedSampler
from backend.active_learning.sampling.margin import MarginSampler
from backend.active_learning.sampling.uncertainty import UncertaintySampler
from backend.config import settings
from backend.core.pipeline import InferenceResult
from backend.logging_config import get_logger

logger = get_logger(__name__)


class ALEngine:
    """
    Active Learning 엔진

    실시간 수집:
    - Gate 마진 구간 샘플 → 큐 A (DistanceBasedSampler)
    - Classify 불확실 샘플 → 큐 B (Uncertainty → Margin 정렬)

    배치 처리:
    - CoreSet으로 다양성 보장된 배치 구성
    - (선택) QBC는 외부에서 inject 가능

    재학습:
    - 레이블된 샘플로 Gate/Classifier 업데이트 트리거
    """

    def __init__(
        self,
        labeling_queue: LabelingQueue | None = None,
        gate_sampler: DistanceBasedSampler | None = None,
        uncertainty_sampler: UncertaintySampler | None = None,
        margin_sampler: MarginSampler | None = None,
        coreset_sampler: CoreSetSampler | None = None,
    ) -> None:
        self.queue = labeling_queue or LabelingQueue(
            max_size=settings.al_queue_max_size,
            queue_dir=settings.al_queue_dir,
        )
        self._gate_sampler = gate_sampler or DistanceBasedSampler(
            margin_low=settings.gate_margin_low,
            margin_high=settings.gate_margin_high,
        )
        self._uncertainty_sampler = uncertainty_sampler or UncertaintySampler(
            threshold=settings.uncertainty_threshold,
        )
        self._margin_sampler = margin_sampler or MarginSampler()
        self._coreset_sampler = coreset_sampler or CoreSetSampler()

        self._collected_gate = 0
        self._collected_classify = 0

    # ── 실시간 수집 ────────────────────────────────────────────────────────

    async def process(
        self,
        frame: np.ndarray,
        result: InferenceResult,
    ) -> bool:
        """
        추론 결과를 보고 AL 후보 여부 판단 후 큐에 추가

        Returns:
            True if sample was added to queue
        """
        added = False

        # ── 큐 A: Gate 경계 샘플 ─────────────────────────────────────────
        if self._gate_sampler.should_collect(result.gate_result):
            priority = self._gate_sampler.score(result.gate_result)
            sample = ALSample(
                sample_id=str(uuid.uuid4()),
                frame=frame.copy(),
                gate_score=result.gate_result.normalized_score,
                classify_probs=None,
                uncertainty_score=0.0,
                margin_score=0.0,
                priority_score=priority,
                queue_type="gate_margin",
            )
            added = self.queue.push(sample)
            if added:
                self._collected_gate += 1

        # ── 큐 B: Classify 불확실 샘플 ───────────────────────────────────
        elif (
            result.classify_result is not None
            and self._uncertainty_sampler.is_uncertain(result.classify_result)
        ):
            uncertainty = self._uncertainty_sampler.uncertainty_score(result.classify_result)
            margin_priority = self._margin_sampler.priority_score(result.classify_result)
            # 두 점수 결합 (uncertainty 70% + margin 30%)
            priority = 0.7 * uncertainty + 0.3 * margin_priority

            sample = ALSample(
                sample_id=str(uuid.uuid4()),
                frame=frame.copy(),
                gate_score=result.gate_result.normalized_score,
                classify_probs=result.classify_result.probabilities,
                uncertainty_score=uncertainty,
                margin_score=result.classify_result.margin,
                priority_score=priority,
                queue_type="classify_uncertain",
            )
            added = self.queue.push(sample)
            if added:
                self._collected_classify += 1

        return added

    # ── 배치 구성 ─────────────────────────────────────────────────────────

    def compose_batch(
        self,
        budget: int | None = None,
        labeled_features: np.ndarray | None = None,
    ) -> list[ALSample]:
        """
        CoreSet으로 다양성 보장된 라벨링 배치 구성

        Args:
            budget: 최대 선택 수 (None이면 settings 기본값)
            labeled_features: 이미 레이블된 샘플의 피처 (편향 방지용)

        Returns:
            우선 라벨링할 샘플 리스트
        """
        budget = budget or settings.al_batch_budget
        unlabeled = self.queue.get_unlabeled()

        if not unlabeled:
            return []

        if len(unlabeled) <= budget:
            return unlabeled

        # 피처가 없으면 priority 점수 기반 상위 budget개 반환
        if labeled_features is None:
            return unlabeled[:budget]

        # CoreSet으로 다양성 선택
        # frame을 피처 대신 사용 (간단히 flatten)
        candidate_features = np.array([
            s.frame.mean(axis=(0, 1))  # 간단한 색상 피처
            for s in unlabeled
        ])

        selected_indices = self._coreset_sampler.select(
            candidate_features=candidate_features,
            labeled_features=labeled_features,
            budget=budget,
        )

        return [unlabeled[i] for i in selected_indices]

    # ── 통계 ──────────────────────────────────────────────────────────────

    @property
    def stats(self) -> dict:
        queue_stats = self.queue.stats
        return {
            **queue_stats,
            "collected_gate": self._collected_gate,
            "collected_classify": self._collected_classify,
        }

    def reset_counters(self) -> None:
        self._collected_gate = 0
        self._collected_classify = 0
