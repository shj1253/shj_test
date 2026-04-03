"""
Active Learning 샘플링 전략 단위 테스트
"""
import numpy as np
import pytest

from backend.active_learning.sampling.distance_based import DistanceBasedSampler
from backend.active_learning.sampling.uncertainty import UncertaintySampler
from backend.active_learning.sampling.margin import MarginSampler
from backend.active_learning.sampling.coreset import CoreSetSampler
from backend.models.base import GateResult, ClassifyResult


# ── 픽스처 헬퍼 ──────────────────────────────────────────────────────────────

def make_gate_result(score: float, in_margin: bool, model_name: str = "patchcore") -> GateResult:
    return GateResult(
        is_target=score >= 0.5,
        score=score,
        normalized_score=score,
        in_margin=in_margin,
        model_name=model_name,
        latency_ms=1.0,
    )


def make_classify_result(
    probs: list[float],
    threshold: float = 0.7,
    model_name: str = "resnet18",
) -> ClassifyResult:
    target_id = int(np.argmax(probs)) + 1
    confidence = max(probs)
    sorted_probs = sorted(probs, reverse=True)
    margin = sorted_probs[0] - sorted_probs[1]
    return ClassifyResult(
        target_id=target_id,
        confidence=confidence,
        probabilities=probs,
        is_uncertain=confidence < threshold,
        margin=margin,
        model_name=model_name,
        latency_ms=1.0,
    )


# ── DistanceBasedSampler ───────────────────────────────────────────────────

class TestDistanceBasedSampler:

    def test_in_margin_should_collect(self):
        sampler = DistanceBasedSampler()
        gate = make_gate_result(score=0.55, in_margin=True)
        assert sampler.should_collect(gate) is True

    def test_not_in_margin_no_collect(self):
        sampler = DistanceBasedSampler()
        gate = make_gate_result(score=0.9, in_margin=False)
        assert sampler.should_collect(gate) is False

    def test_score_at_midpoint_max(self):
        """margin 중간점에 가장 가까울수록 score 높음"""
        sampler = DistanceBasedSampler(margin_low=0.4, margin_high=0.6)
        gate_mid = make_gate_result(score=0.5, in_margin=True)
        gate_edge = make_gate_result(score=0.41, in_margin=True)
        assert sampler.score(gate_mid) > sampler.score(gate_edge)

    def test_score_range(self):
        sampler = DistanceBasedSampler()
        gate = make_gate_result(score=0.5, in_margin=True)
        s = sampler.score(gate)
        assert 0.0 <= s <= 1.0


# ── UncertaintySampler ────────────────────────────────────────────────────

class TestUncertaintySampler:

    def test_low_confidence_uncertain(self):
        sampler = UncertaintySampler(threshold=0.7)
        result = make_classify_result([0.5, 0.3, 0.1, 0.1])
        assert sampler.is_uncertain(result) is True

    def test_high_confidence_certain(self):
        sampler = UncertaintySampler(threshold=0.7)
        result = make_classify_result([0.9, 0.05, 0.03, 0.02])
        assert sampler.is_uncertain(result) is False

    def test_uncertainty_score_inversely_proportional(self):
        sampler = UncertaintySampler(threshold=0.7)
        low = make_classify_result([0.55, 0.25, 0.1, 0.1])
        high = make_classify_result([0.9, 0.05, 0.03, 0.02])
        assert sampler.uncertainty_score(low) > sampler.uncertainty_score(high)

    def test_uncertainty_score_range(self):
        sampler = UncertaintySampler()
        result = make_classify_result([0.6, 0.2, 0.1, 0.1])
        s = sampler.uncertainty_score(result)
        assert 0.0 <= s <= 1.0


# ── MarginSampler ─────────────────────────────────────────────────────────

class TestMarginSampler:

    def test_small_margin_high_priority(self):
        sampler = MarginSampler()
        small = make_classify_result([0.51, 0.49, 0.0, 0.0])  # 거의 동점
        large = make_classify_result([0.9, 0.05, 0.03, 0.02])
        assert sampler.priority_score(small) > sampler.priority_score(large)

    def test_priority_score_range(self):
        sampler = MarginSampler()
        result = make_classify_result([0.6, 0.3, 0.05, 0.05])
        s = sampler.priority_score(result)
        assert 0.0 <= s <= 1.0

    def test_sort_ascending_margin(self):
        sampler = MarginSampler()
        results = [
            make_classify_result([0.9, 0.05, 0.03, 0.02]),   # 큰 margin
            make_classify_result([0.51, 0.49, 0.0, 0.0]),     # 작은 margin
            make_classify_result([0.7, 0.2, 0.05, 0.05]),    # 중간 margin
        ]
        # sort_by_priority는 (원래인덱스, ClassifyResult) 튜플 리스트 반환
        sorted_indexed = sampler.sort_by_priority(results)
        # margin 오름차순 = priority_score 내림차순
        margins = [r.margin for _, r in sorted_indexed]
        assert margins == sorted(margins)


# ── CoreSetSampler ────────────────────────────────────────────────────────

class TestCoreSetSampler:

    def test_select_returns_budget_count(self):
        sampler = CoreSetSampler()
        candidates = np.random.rand(20, 64).tolist()
        labeled = np.random.rand(10, 64).tolist()
        selected_idx = sampler.select(candidates, labeled, budget=5)
        assert len(selected_idx) == 5

    def test_select_no_duplicates(self):
        sampler = CoreSetSampler()
        candidates = np.random.rand(20, 64).tolist()
        labeled = np.random.rand(5, 64).tolist()
        selected_idx = sampler.select(candidates, labeled, budget=10)
        assert len(set(selected_idx)) == len(selected_idx)

    def test_select_empty_labeled(self):
        """labeled가 없을 때도 동작해야 함"""
        sampler = CoreSetSampler()
        candidates = np.random.rand(10, 64).tolist()
        selected_idx = sampler.select(candidates, [], budget=3)
        assert len(selected_idx) == 3

    def test_select_budget_exceeds_candidates(self):
        """budget > candidates면 전부 선택"""
        sampler = CoreSetSampler()
        candidates = np.random.rand(5, 64).tolist()
        selected_idx = sampler.select(candidates, [], budget=100)
        assert len(selected_idx) == 5

    def test_diversity_farthest_first(self):
        """첫 선택이 labeled에서 가장 먼 것이어야 함"""
        sampler = CoreSetSampler()
        # labeled = 원점
        labeled = [[0.0] * 4]
        # candidates: 가까운 것과 먼 것
        candidates = [
            [0.1, 0.1, 0.1, 0.1],   # 가까움
            [10.0, 10.0, 10.0, 10.0],  # 멂
        ]
        selected_idx = sampler.select(candidates, labeled, budget=1)
        assert selected_idx[0] == 1  # 먼 것이 먼저 선택
