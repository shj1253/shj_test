"""
순서 검증 State Machine — T1 → T2 → T3 → T4
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from backend.exceptions import UndoNotAvailableError
from backend.logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class SequenceEvent:
    target_id: int
    accepted: bool
    timestamp: datetime
    state_before: str
    state_after: str


@dataclass
class SequenceResult:
    accepted: bool
    target_id: int
    current_state: str
    next_expected: int | None   # 다음에 기다리는 Target (None = COMPLETE)
    violation_reason: str | None = None


class SequenceStateMachine:
    """
    T1 → T2 → ... → Tn 순서 검증 State Machine (타겟 수 동적 설정)

    상태 전이:
      WAIT_T1 + T1 → WAIT_T2
      WAIT_T2 + T2 → WAIT_T3
      ...
      WAIT_Tn + Tn → COMPLETE
      순서 불일치 → 상태 유지 (무시)

    Undo:
      history 스택에서 마지막 전이를 되돌림
    """

    def __init__(
        self,
        num_targets: int = 4,
        on_target_detected: Callable[[int, str], None] | None = None,
        on_complete: Callable[[], None] | None = None,
        on_violation: Callable[[int, str, str], None] | None = None,
    ) -> None:
        """
        Args:
            num_targets: 검출할 Target 총 수 (기본 4, 현장에 따라 변경 가능)
            on_target_detected: (target_id, state) 콜백
            on_complete: 시퀀스 완료 콜백
            on_violation: (target_id, current_state, reason) 콜백
        """
        if num_targets < 1:
            raise ValueError(f"num_targets must be >= 1, got {num_targets}")
        self._num_targets = num_targets
        self.STATES = (
            ["IDLE"]
            + [f"WAIT_T{i}" for i in range(1, num_targets + 1)]
            + ["COMPLETE"]
        )
        self.TRANSITIONS: dict[str, dict[str, Any]] = self._build_transitions(num_targets)
        self._state = "WAIT_T1"
        self._history: list[SequenceEvent] = []
        self._on_target_detected = on_target_detected
        self._on_complete = on_complete
        self._on_violation = on_violation

    @staticmethod
    def _build_transitions(n: int) -> dict[str, dict[str, Any]]:
        """num_targets에 맞는 전이 테이블 동적 생성"""
        transitions = {}
        for i in range(1, n + 1):
            transitions[f"WAIT_T{i}"] = {
                "expected": i,
                "next_state": f"WAIT_T{i + 1}" if i < n else "COMPLETE",
                "next_expected": i + 1 if i < n else None,
            }
        return transitions

    @property
    def num_targets(self) -> int:
        return self._num_targets

    # ── 상태 조회 ──────────────────────────────────────────────────────────

    @property
    def current_state(self) -> str:
        return self._state

    @property
    def next_expected(self) -> int | None:
        """현재 기다리는 Target ID (COMPLETE면 None)"""
        if self._state == "COMPLETE":
            return None
        if self._state not in self.TRANSITIONS:
            return None
        return self.TRANSITIONS[self._state]["expected"]

    @property
    def history(self) -> list[SequenceEvent]:
        return list(self._history)

    @property
    def is_complete(self) -> bool:
        return self._state == "COMPLETE"

    # ── 핵심 전이 ──────────────────────────────────────────────────────────

    def transition(self, target_id: int) -> SequenceResult:
        """
        분류기가 target_id를 판정했을 때 순서 검증

        Returns:
            SequenceResult: accepted=True면 확정, False면 무시
        """
        state_before = self._state

        if self._state == "COMPLETE":
            return SequenceResult(
                accepted=False,
                target_id=target_id,
                current_state=self._state,
                next_expected=None,
                violation_reason="Sequence already complete",
            )

        if self._state not in self.TRANSITIONS:
            return SequenceResult(
                accepted=False,
                target_id=target_id,
                current_state=self._state,
                next_expected=None,
                violation_reason=f"Invalid state: {self._state}",
            )

        rule = self.TRANSITIONS[self._state]
        expected = rule["expected"]

        if target_id != expected:
            # 순서 불일치 → 무시
            reason = (
                f"Expected T{expected}, got T{target_id} "
                f"(state: {self._state})"
            )
            logger.warning(
                "Sequence violation",
                expected=expected,
                got=target_id,
                state=self._state,
            )
            event = SequenceEvent(
                target_id=target_id,
                accepted=False,
                timestamp=datetime.now(),
                state_before=state_before,
                state_after=self._state,
            )
            self._history.append(event)

            if self._on_violation:
                self._on_violation(target_id, self._state, reason)

            return SequenceResult(
                accepted=False,
                target_id=target_id,
                current_state=self._state,
                next_expected=expected,
                violation_reason=reason,
            )

        # 순서 일치 → 전이
        next_state = rule["next_state"]
        next_expected = rule["next_expected"]
        self._state = next_state

        event = SequenceEvent(
            target_id=target_id,
            accepted=True,
            timestamp=datetime.now(),
            state_before=state_before,
            state_after=next_state,
        )
        self._history.append(event)

        logger.info(
            "Sequence transition",
            target_id=target_id,
            state_before=state_before,
            state_after=next_state,
        )

        if self._on_target_detected:
            self._on_target_detected(target_id, next_state)

        if next_state == "COMPLETE" and self._on_complete:
            logger.info("Sequence COMPLETE — all targets detected")
            self._on_complete()

        return SequenceResult(
            accepted=True,
            target_id=target_id,
            current_state=next_state,
            next_expected=next_expected,
        )

    # ── Undo ──────────────────────────────────────────────────────────────

    def undo_last(self) -> SequenceEvent:
        """
        마지막으로 accepted된 전이를 취소
        - 히스토리에서 마지막 accepted 이벤트를 찾아 이전 상태로 복구

        Returns:
            되돌린 이벤트

        Raises:
            UndoNotAvailableError: 되돌릴 전이가 없을 때
        """
        # 마지막 accepted 이벤트 찾기
        last_accepted_idx = None
        for i in range(len(self._history) - 1, -1, -1):
            if self._history[i].accepted:
                last_accepted_idx = i
                break

        if last_accepted_idx is None:
            raise UndoNotAvailableError("No accepted transitions to undo")

        event = self._history[last_accepted_idx]
        self._state = event.state_before
        self._history.pop(last_accepted_idx)

        logger.info(
            "Sequence undo",
            reverted_target=event.target_id,
            restored_state=self._state,
        )
        return event

    # ── 리셋 ──────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """State Machine을 초기 상태로 리셋"""
        logger.info("StateMachine reset", prev_state=self._state)
        self._state = "WAIT_T1"
        self._history.clear()

    # ── 직렬화 ────────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "num_targets": self._num_targets,
            "current_state": self._state,
            "next_expected": self.next_expected,
            "is_complete": self.is_complete,
            "history": [
                {
                    "target_id": e.target_id,
                    "accepted": e.accepted,
                    "timestamp": e.timestamp.isoformat(),
                    "state_before": e.state_before,
                    "state_after": e.state_after,
                }
                for e in self._history
            ],
        }

    def __repr__(self) -> str:
        return (
            f"SequenceStateMachine("
            f"state={self._state!r}, "
            f"next={self.next_expected}, "
            f"history_len={len(self._history)})"
        )
