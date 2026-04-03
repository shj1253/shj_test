"""
AL 레이블링 큐 — 미라벨 샘플 관리 + Undo 지원
"""
from __future__ import annotations

import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
import pickle

import numpy as np

from backend.exceptions import ALQueueFullError, LabelingError, SampleNotFoundError
from backend.logging_config import get_logger
from backend.models.base import GateResult, ClassifyResult

logger = get_logger(__name__)


@dataclass
class ALSample:
    sample_id: str
    frame: np.ndarray
    gate_score: float
    classify_probs: list[float] | None
    uncertainty_score: float
    margin_score: float
    priority_score: float          # 높을수록 먼저 라벨링
    queue_type: str                # "gate_margin" | "classify_uncertain"
    added_at: datetime = field(default_factory=datetime.now)
    label: int | None = None       # None = 미라벨
    labeled_at: datetime | None = None


@dataclass
class LabelAction:
    """Undo 스택용 레이블링 액션 기록"""
    sample_id: str
    label: int
    labeled_at: datetime
    action: str = "label"          # "label" | "undo"


class LabelingQueue:
    """
    AL 샘플 저장소 + 우선순위 큐 + Undo 스택

    기능:
    - 샘플 push/pop (우선순위 기반)
    - 레이블 제출 (label)
    - 레이블 취소 (undo_label)
    - 레이블된 샘플 일괄 조회 (get_labeled)
    - 큐 상태 직렬화 (checkpoint/restore)
    """

    def __init__(
        self,
        max_size: int = 1000,
        queue_dir: Path | None = None,
    ) -> None:
        self.max_size = max_size
        self.queue_dir = queue_dir or Path("artifacts/data/al_queue")

        self._unlabeled: dict[str, ALSample] = {}   # sample_id → sample
        self._labeled: dict[str, ALSample] = {}
        self._undo_stack: list[LabelAction] = []
        self._total_added: int = 0

    # ── 추가 ──────────────────────────────────────────────────────────────

    def push(self, sample: ALSample) -> bool:
        """
        샘플 추가. 중복(같은 priority 범위) 제거 후 추가.

        Returns:
            True if added, False if full or duplicate
        """
        if len(self._unlabeled) >= self.max_size:
            # 우선순위 낮은 것 제거 후 추가
            lowest_id = min(
                self._unlabeled,
                key=lambda k: self._unlabeled[k].priority_score
            )
            if self._unlabeled[lowest_id].priority_score >= sample.priority_score:
                return False  # 새 샘플이 더 낮은 우선순위 → 버림
            del self._unlabeled[lowest_id]

        self._unlabeled[sample.sample_id] = sample
        self._total_added += 1

        logger.debug(
            "AL sample added",
            sample_id=sample.sample_id[:8],
            queue_type=sample.queue_type,
            priority=round(sample.priority_score, 3),
            queue_size=len(self._unlabeled),
        )
        return True

    # ── 조회 ──────────────────────────────────────────────────────────────

    def pop_batch(self, n: int) -> list[ALSample]:
        """우선순위 높은 순 n개 반환 (큐에서 제거하지 않음)"""
        sorted_samples = sorted(
            self._unlabeled.values(),
            key=lambda s: s.priority_score,
            reverse=True,
        )
        return sorted_samples[:n]

    def get_unlabeled(self) -> list[ALSample]:
        """모든 미라벨 샘플 (우선순위 내림차순)"""
        return sorted(
            self._unlabeled.values(),
            key=lambda s: s.priority_score,
            reverse=True,
        )

    def get_labeled(self) -> list[ALSample]:
        """레이블 완료 샘플"""
        return list(self._labeled.values())

    def get_sample(self, sample_id: str) -> ALSample:
        if sample_id in self._unlabeled:
            return self._unlabeled[sample_id]
        if sample_id in self._labeled:
            return self._labeled[sample_id]
        raise SampleNotFoundError(f"Sample {sample_id} not found")

    # ── 레이블링 ──────────────────────────────────────────────────────────

    def label(self, sample_id: str, label: int) -> ALSample:
        """
        샘플에 레이블 부여 → unlabeled → labeled 이동

        Args:
            sample_id: 샘플 ID
            label: 0-indexed (0=T1, 1=T2, 2=T3, 3=T4)
        """
        if sample_id not in self._unlabeled:
            if sample_id in self._labeled:
                raise LabelingError(
                    f"Sample {sample_id} already labeled",
                    detail=f"Current label: {self._labeled[sample_id].label}",
                )
            raise SampleNotFoundError(f"Sample {sample_id} not found in unlabeled queue")

        sample = self._unlabeled.pop(sample_id)
        sample.label = label
        sample.labeled_at = datetime.now()
        self._labeled[sample_id] = sample

        action = LabelAction(
            sample_id=sample_id,
            label=label,
            labeled_at=sample.labeled_at,
        )
        self._undo_stack.append(action)

        logger.info(
            "Sample labeled",
            sample_id=sample_id[:8],
            label=f"T{label + 1}",
            remaining_unlabeled=len(self._unlabeled),
        )
        return sample

    def undo_label(self, sample_id: str | None = None) -> ALSample:
        """
        레이블 취소 → labeled → unlabeled 복귀

        Args:
            sample_id: None이면 마지막 레이블 취소

        Returns:
            취소된 샘플
        """
        if not self._undo_stack:
            raise LabelingError("No labels to undo")

        if sample_id is None:
            action = self._undo_stack.pop()
        else:
            matching = [a for a in self._undo_stack if a.sample_id == sample_id]
            if not matching:
                raise SampleNotFoundError(f"No label action for {sample_id}")
            action = matching[-1]
            self._undo_stack.remove(action)

        target_id = action.sample_id
        if target_id not in self._labeled:
            raise SampleNotFoundError(f"Labeled sample {target_id} not found")

        sample = self._labeled.pop(target_id)
        sample.label = None
        sample.labeled_at = None
        self._unlabeled[target_id] = sample

        logger.info(
            "Label undone",
            sample_id=target_id[:8],
            reverted_label=f"T{action.label + 1}",
        )
        return sample

    # ── 상태 ─────────────────────────────────────────────────────────────

    @property
    def stats(self) -> dict:
        return {
            "unlabeled_count": len(self._unlabeled),
            "labeled_count": len(self._labeled),
            "total_added": self._total_added,
            "undo_stack_depth": len(self._undo_stack),
            "capacity": self.max_size,
        }

    def clear_labeled(self) -> list[ALSample]:
        """레이블 완료 샘플 전체 반환 후 큐에서 제거 (재학습 트리거 후 호출)"""
        labeled = list(self._labeled.values())
        self._labeled.clear()
        self._undo_stack.clear()
        logger.info("Labeled samples cleared", count=len(labeled))
        return labeled

    # ── 체크포인트 ────────────────────────────────────────────────────────

    def save_checkpoint(self) -> None:
        """큐 상태 디스크 저장"""
        self.queue_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "unlabeled": {k: {**v.__dict__, "frame": None} for k, v in self._unlabeled.items()},
            "labeled": {k: {**v.__dict__, "frame": None} for k, v in self._labeled.items()},
            "undo_stack": [a.__dict__ for a in self._undo_stack],
            "total_added": self._total_added,
        }
        with open(self.queue_dir / "queue_checkpoint.pkl", "wb") as f:
            pickle.dump(data, f)
        logger.info("AL queue checkpoint saved")
