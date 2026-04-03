"""
LabelingQueue 단위 테스트
"""
import numpy as np
import pytest

from backend.active_learning.labeling_queue import LabelingQueue, ALSample
from backend.exceptions import LabelingError, SampleNotFoundError


def make_sample(
    sample_id: str = "s1",
    priority_score: float = 0.5,
    queue_type: str = "gate_margin",
) -> ALSample:
    return ALSample(
        sample_id=sample_id,
        frame=np.zeros((224, 224, 3), dtype=np.uint8),
        gate_score=0.6,
        classify_probs=[0.4, 0.3, 0.2, 0.1],
        uncertainty_score=0.4,
        margin_score=0.1,
        priority_score=priority_score,
        queue_type=queue_type,
    )


class TestPush:

    def test_push_single(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a", priority_score=0.8))
        assert q.stats["unlabeled_count"] == 1

    def test_push_evicts_lowest_priority_when_full(self):
        q = LabelingQueue(max_size=3)
        q.push(make_sample("a", priority_score=0.9))
        q.push(make_sample("b", priority_score=0.5))
        q.push(make_sample("c", priority_score=0.7))
        # 꽉 참 — 우선순위 낮은 것(b=0.5) 제거 후 추가
        q.push(make_sample("d", priority_score=0.8))
        ids = [s.sample_id for s in q.get_unlabeled()]
        assert "b" not in ids
        assert "d" in ids

    def test_push_high_priority_not_evicted(self):
        q = LabelingQueue(max_size=2)
        q.push(make_sample("a", priority_score=0.9))
        q.push(make_sample("b", priority_score=0.8))
        # 새로 들어오는 것이 기존보다 낮으면 버림
        added = q.push(make_sample("c", priority_score=0.1))
        assert added is False
        ids = [s.sample_id for s in q.get_unlabeled()]
        assert "c" not in ids
        assert len(ids) == 2


class TestLabel:

    def test_label_moves_to_labeled(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.label("a", label=0)  # T1 = 0-indexed
        assert q.stats["unlabeled_count"] == 0
        assert q.stats["labeled_count"] == 1
        assert q.get_labeled()[0].label == 0

    def test_label_unknown_id_raises(self):
        q = LabelingQueue(max_size=10)
        with pytest.raises(SampleNotFoundError):
            q.label("nonexistent", label=1)

    def test_label_already_labeled_raises(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.label("a", label=0)
        with pytest.raises(LabelingError):
            q.label("a", label=1)


class TestUndo:

    def test_undo_label(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.label("a", label=1)
        q.undo_label()
        assert q.stats["labeled_count"] == 0
        assert q.stats["unlabeled_count"] == 1

    def test_undo_empty_raises(self):
        q = LabelingQueue(max_size=10)
        with pytest.raises(LabelingError):
            q.undo_label()

    def test_undo_multiple(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.push(make_sample("b"))
        q.label("a", label=0)
        q.label("b", label=1)
        q.undo_label()  # b 되돌리기
        assert q.stats["labeled_count"] == 1
        assert q.get_labeled()[0].sample_id == "a"
        assert q.stats["unlabeled_count"] == 1


class TestClearLabeled:

    def test_clear_labeled(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.label("a", label=0)
        cleared = q.clear_labeled()
        assert q.stats["labeled_count"] == 0
        assert len(cleared) == 1

    def test_clear_does_not_affect_unlabeled(self):
        q = LabelingQueue(max_size=10)
        q.push(make_sample("a"))
        q.push(make_sample("b"))
        q.label("a", label=0)
        q.clear_labeled()
        assert q.stats["unlabeled_count"] == 1
        assert q.get_unlabeled()[0].sample_id == "b"
