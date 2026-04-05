"""
AL 레이블링 큐 — 미라벨 샘플 관리 + Undo 지원
"""
from __future__ import annotations

import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Deque
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
        max_labeled_size: int | None = None,
    ) -> None:
        self.max_size = max_size
        # C-4 fix: cap labeled dict to prevent unbounded memory growth
        self.max_labeled_size: int = max_labeled_size or max(50, max_size // 5)
        self.queue_dir = queue_dir or Path("artifacts/data/al_queue")

        self._unlabeled: dict[str, ALSample] = {}   # sample_id → sample
        self._labeled: dict[str, ALSample] = {}
        self._undo_stack: list[LabelAction] = []
        self._total_added: int = 0

        # H-4 fix: frame fingerprint dedup — tracks _unlabeled frames only
        self._frame_prints: dict[str, bytes] = {}   # sample_id → fingerprint
        self._print_set: set[bytes] = set()         # O(1) lookup

        # C-R6-1 fix: audit trail for evicted labeled samples (no frame, metadata only)
        # C-R7-1 fix: bounded deque so audit trail itself cannot grow unbounded
        self._evicted_labels: deque[dict] = deque(maxlen=1000)  # [{sample_id, label, labeled_at, evicted_at}]

    @staticmethod
    def _frame_fingerprint(frame: np.ndarray) -> bytes:
        """Lightweight frame fingerprint using 8×8 downsampled intensity grid."""
        h, w = frame.shape[:2]
        step_h, step_w = max(1, h // 8), max(1, w // 8)
        thumb = frame[::step_h, ::step_w][:8, :8]
        if thumb.ndim == 3:
            thumb = thumb.mean(axis=2)
        return thumb.astype(np.uint8).tobytes()

    # ── 추가 ──────────────────────────────────────────────────────────────

    def push(self, sample: ALSample) -> bool:
        """
        샘플 추가. 중복 프레임 제거 + 우선순위 기반 eviction.

        Returns:
            True if added, False if full/duplicate/lower-priority
        """
        # H-4 fix: reject duplicate frames by fingerprint
        if sample.frame is not None:
            fp = self._frame_fingerprint(sample.frame)
            if fp in self._print_set:
                return False
        else:
            fp = None

        if len(self._unlabeled) >= self.max_size:
            # 우선순위 낮은 것 제거 후 추가 (tie-break: 오래된 것 우선 제거)
            lowest_id = min(
                self._unlabeled,
                key=lambda k: (
                    self._unlabeled[k].priority_score,
                    -(self._unlabeled[k].added_at.timestamp()),
                )
            )
            if self._unlabeled[lowest_id].priority_score >= sample.priority_score:
                return False  # 새 샘플이 더 낮은 우선순위 → 버림
            evicted_id = lowest_id
            self._unlabeled.pop(evicted_id)
            evicted_fp = self._frame_prints.pop(evicted_id, None)
            if evicted_fp:
                self._print_set.discard(evicted_fp)

        self._unlabeled[sample.sample_id] = sample
        if fp is not None:
            self._frame_prints[sample.sample_id] = fp
            self._print_set.add(fp)
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
        # Remove from fingerprint tracking (no longer in unlabeled)
        evicted_fp = self._frame_prints.pop(sample_id, None)
        if evicted_fp:
            self._print_set.discard(evicted_fp)

        sample.label = label
        sample.labeled_at = datetime.now()
        self._labeled[sample_id] = sample

        # C-4 fix: evict oldest labeled sample if over capacity to prevent memory leak
        if len(self._labeled) > self.max_labeled_size:
            oldest_id = min(
                self._labeled,
                key=lambda k: self._labeled[k].labeled_at or datetime.min,
            )
            evicted = self._labeled.pop(oldest_id)
            # C-R6-1 fix: record in audit trail before evicting (silent data loss prevention)
            self._evicted_labels.append({
                "sample_id": oldest_id,
                "label": evicted.label,
                "labeled_at": evicted.labeled_at.isoformat() if evicted.labeled_at else None,
                "evicted_at": datetime.now().isoformat(),
            })
            evicted.frame = None  # explicit frame memory release
            # Also remove from undo stack if present
            self._undo_stack = [a for a in self._undo_stack if a.sample_id != oldest_id]
            # C-R6-1 fix: warning level so operators can detect training data loss
            logger.warning(
                "Labeled sample evicted due to capacity limit — call clear_labeled() more frequently",
                sample_id=oldest_id[:8],
                label=evicted.label,
                labeled_queue_size=len(self._labeled),
                evicted_total=len(self._evicted_labels),
            )

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

        # H-R8-2 fix: peek action FIRST, validate BEFORE removing from undo_stack
        # (removing then raising LabelingError leaves undo_stack permanently modified — retry impossible)
        if sample_id is None:
            action = self._undo_stack[-1]  # peek
        else:
            matching = [a for a in self._undo_stack if a.sample_id == sample_id]
            if not matching:
                raise SampleNotFoundError(f"No label action for {sample_id}")
            action = matching[-1]  # peek

        target_id = action.sample_id
        if target_id not in self._labeled:
            # H-R7-1 fix: distinguish evicted samples from truly missing ones
            evicted_ids = {e["sample_id"] for e in self._evicted_labels}
            if target_id in evicted_ids:
                raise LabelingError(
                    f"Sample {target_id[:8]} was evicted from labeled cache — cannot undo",
                    detail="The labeled sample was removed to prevent memory overflow. "
                           "Call clear_labeled() more frequently to avoid eviction.",
                )
            raise SampleNotFoundError(f"Labeled sample {target_id} not found")

        # Validation passed — now commit removal from undo_stack
        if sample_id is None:
            self._undo_stack.pop()
        else:
            self._undo_stack.remove(action)

        sample = self._labeled.pop(target_id)
        sample.label = None
        sample.labeled_at = None
        self._unlabeled[target_id] = sample

        # Restore fingerprint tracking
        if sample.frame is not None:
            fp = self._frame_fingerprint(sample.frame)
            self._frame_prints[target_id] = fp
            self._print_set.add(fp)

        logger.info(
            "Label undone",
            sample_id=target_id[:8],
            reverted_label=f"T{action.label + 1}",
        )
        return sample

    def remove(self, sample_id: str) -> None:
        """
        샘플을 큐에서 완전히 제거 (스킵 — 레이블 없이 폐기)

        Args:
            sample_id: 제거할 샘플 ID
        """
        if sample_id in self._unlabeled:
            del self._unlabeled[sample_id]
            fp = self._frame_prints.pop(sample_id, None)
            if fp:
                self._print_set.discard(fp)
            logger.info("Sample skipped/removed", sample_id=sample_id[:8])
            return
        if sample_id in self._labeled:
            raise LabelingError(
                f"이미 레이블된 샘플은 스킵할 수 없습니다: {sample_id}",
                detail="undo_label을 먼저 호출하세요.",
            )
        raise SampleNotFoundError(f"샘플을 찾을 수 없습니다: {sample_id}")

    # ── 상태 ─────────────────────────────────────────────────────────────

    @property
    def stats(self) -> dict:
        return {
            "unlabeled_count": len(self._unlabeled),
            "labeled_count": len(self._labeled),
            "total_added": self._total_added,
            "undo_stack_depth": len(self._undo_stack),
            "capacity": self.max_size,
            "evicted_labeled_count": len(self._evicted_labels),  # C-R6-1: data loss indicator
        }

    def clear_labeled(self) -> list[ALSample]:
        """레이블 완료 샘플 전체 반환 후 큐에서 제거 (재학습 트리거 후 호출)"""
        labeled = list(self._labeled.values())
        self._labeled.clear()
        self._undo_stack.clear()
        # labeled samples were already removed from fingerprint set at label() time
        logger.info("Labeled samples cleared", count=len(labeled))
        return labeled

    # ── 체크포인트 ────────────────────────────────────────────────────────

    def save_checkpoint(self) -> None:
        """큐 상태 + 프레임 데이터 디스크 저장 (C-3 fix: 프레임을 .npy로 분리 저장)"""
        self.queue_dir.mkdir(parents=True, exist_ok=True)
        frames_dir = self.queue_dir / "frames"
        frames_dir.mkdir(exist_ok=True)

        unlabeled_data: dict = {}
        labeled_data: dict = {}
        frames_saved = 0

        for k, v in self._unlabeled.items():
            if v.frame is not None:
                np.save(frames_dir / f"{k}.npy", v.frame)
                frames_saved += 1
            unlabeled_data[k] = {**v.__dict__, "frame": None}

        for k, v in self._labeled.items():
            if v.frame is not None:
                np.save(frames_dir / f"{k}.npy", v.frame)
                frames_saved += 1
            labeled_data[k] = {**v.__dict__, "frame": None}

        data = {
            "unlabeled": unlabeled_data,
            "labeled": labeled_data,
            "undo_stack": [a.__dict__ for a in self._undo_stack],
            "total_added": self._total_added,
        }
        with open(self.queue_dir / "queue_checkpoint.pkl", "wb") as f:
            pickle.dump(data, f)
        logger.info("AL queue checkpoint saved", frames_saved=frames_saved)
