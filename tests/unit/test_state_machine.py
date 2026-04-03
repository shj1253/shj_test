"""
상태 머신 단위 테스트 — SequenceStateMachine
"""
import pytest

from backend.core.state_machine import SequenceStateMachine
from backend.exceptions import UndoNotAvailableError


class TestNormalFlow:
    """정상 시퀀스 T1→T2→T3→T4"""

    def test_initial_state(self):
        sm = SequenceStateMachine()
        assert sm.current_state == "WAIT_T1"
        assert sm.next_expected == 1
        assert not sm.is_complete

    def test_full_sequence(self):
        sm = SequenceStateMachine()
        for tid, expected_state in [
            (1, "WAIT_T2"),
            (2, "WAIT_T3"),
            (3, "WAIT_T4"),
            (4, "COMPLETE"),
        ]:
            r = sm.transition(tid)
            assert r.accepted, f"T{tid} should be accepted"
            assert r.target_id == tid
            assert sm.current_state == expected_state

        assert sm.is_complete
        assert sm.next_expected is None

    def test_callbacks_fired(self):
        detected = []
        completed = []

        sm = SequenceStateMachine(
            on_target_detected=lambda tid, state: detected.append((tid, state)),
            on_complete=lambda: completed.append(True),
        )
        for tid in [1, 2, 3, 4]:
            sm.transition(tid)

        assert len(detected) == 4
        assert detected[0] == (1, "WAIT_T2")
        assert detected[3] == (4, "COMPLETE")
        assert len(completed) == 1


class TestViolation:
    """순서 위반"""

    def test_wrong_order_ignored(self):
        sm = SequenceStateMachine()
        r = sm.transition(2)  # T2 먼저 — 위반
        assert not r.accepted
        assert r.violation_reason is not None
        assert sm.current_state == "WAIT_T1"  # 상태 유지

    def test_violation_callback(self):
        violations = []
        sm = SequenceStateMachine(
            on_violation=lambda tid, state, reason: violations.append(tid)
        )
        sm.transition(3)
        sm.transition(2)
        assert len(violations) == 2

    def test_already_complete(self):
        sm = SequenceStateMachine()
        for tid in [1, 2, 3, 4]:
            sm.transition(tid)
        r = sm.transition(1)  # 완료 후 재시도
        assert not r.accepted
        assert "complete" in r.violation_reason.lower()

    def test_partial_then_wrong(self):
        sm = SequenceStateMachine()
        sm.transition(1)  # T1 OK
        r = sm.transition(3)  # T3 — 위반 (T2 기다리는 중)
        assert not r.accepted
        assert sm.current_state == "WAIT_T2"


class TestUndo:
    """Undo 기능"""

    def test_undo_last(self):
        sm = SequenceStateMachine()
        sm.transition(1)
        sm.transition(2)
        event = sm.undo_last()
        assert event.target_id == 2
        assert sm.current_state == "WAIT_T2"

    def test_undo_skips_violation(self):
        sm = SequenceStateMachine()
        sm.transition(1)   # accepted
        sm.transition(3)   # violation — 무시되어야 함
        event = sm.undo_last()
        assert event.target_id == 1  # 위반 건너뛰고 T1 undo
        assert sm.current_state == "WAIT_T1"

    def test_undo_nothing_raises(self):
        sm = SequenceStateMachine()
        with pytest.raises(UndoNotAvailableError):
            sm.undo_last()

    def test_undo_then_redo(self):
        sm = SequenceStateMachine()
        sm.transition(1)
        sm.undo_last()
        r = sm.transition(1)  # 다시 T1
        assert r.accepted
        assert sm.current_state == "WAIT_T2"


class TestReset:
    """리셋"""

    def test_reset_clears_state(self):
        sm = SequenceStateMachine()
        for tid in [1, 2, 3]:
            sm.transition(tid)
        sm.reset()
        assert sm.current_state == "WAIT_T1"
        assert sm.history == []
        assert not sm.is_complete

    def test_reset_then_full_sequence(self):
        sm = SequenceStateMachine()
        sm.transition(1)
        sm.reset()
        for tid in [1, 2, 3, 4]:
            r = sm.transition(tid)
            assert r.accepted
        assert sm.is_complete


class TestSerialization:
    """to_dict 직렬화"""

    def test_to_dict_structure(self):
        sm = SequenceStateMachine()
        sm.transition(1)
        d = sm.to_dict()
        assert d["current_state"] == "WAIT_T2"
        assert d["next_expected"] == 2
        assert not d["is_complete"]
        assert len(d["history"]) == 1
        assert d["history"][0]["accepted"] is True
        assert d["history"][0]["target_id"] == 1

    def test_to_dict_complete(self):
        sm = SequenceStateMachine()
        for tid in [1, 2, 3, 4]:
            sm.transition(tid)
        d = sm.to_dict()
        assert d["is_complete"]
        assert d["next_expected"] is None
        assert len(d["history"]) == 4
