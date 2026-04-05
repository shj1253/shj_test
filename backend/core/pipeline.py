"""
3단 추론 파이프라인 오케스트레이터
Gate → Classify → Sequence
"""
from __future__ import annotations

import asyncio
import functools
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from backend.core.state_machine import SequenceResult, SequenceStateMachine
from backend.exceptions import FrameProcessingError, InferenceError, ModelNotLoadedError
from backend.logging_config import bind_frame_context, clear_frame_context, get_logger
from backend.models.base import BaseClassifierModel, BaseGateModel, ClassifyResult, GateResult

logger = get_logger(__name__)


@dataclass
class InferenceResult:
    frame_id: str
    gate_result: GateResult
    classify_result: ClassifyResult | None        # Gate 통과 시에만
    sequence_result: SequenceResult | None        # Classify 통과 시에만
    total_latency_ms: float
    timestamp: datetime = field(default_factory=datetime.now)
    error: str | None = None

    @property
    def is_confirmed(self) -> bool:
        """3단계 모두 통과해서 최종 확정된 경우"""
        return (
            self.gate_result.is_target
            and self.classify_result is not None
            and self.sequence_result is not None
            and self.sequence_result.accepted
        )

    def to_dict(self) -> dict:
        return {
            "frame_id": self.frame_id,
            "is_confirmed": self.is_confirmed,
            "gate": {
                "is_target": self.gate_result.is_target,
                "normalized_score": self.gate_result.normalized_score,
                "in_margin": self.gate_result.in_margin,
                "latency_ms": self.gate_result.latency_ms,
                "model": self.gate_result.model_name,
            },
            "classify": {
                "target_id": self.classify_result.target_id,
                "confidence": self.classify_result.confidence,
                "probabilities": self.classify_result.probabilities,
                "is_uncertain": self.classify_result.is_uncertain,
                "margin": self.classify_result.margin,
                "latency_ms": self.classify_result.latency_ms,
            } if self.classify_result else None,
            "sequence": {
                "accepted": self.sequence_result.accepted,
                "current_state": self.sequence_result.current_state,
                "next_expected": self.sequence_result.next_expected,
                "violation_reason": self.sequence_result.violation_reason,
            } if self.sequence_result else None,
            "total_latency_ms": self.total_latency_ms,
            "timestamp": self.timestamp.isoformat(),
            "error": self.error,
        }


class InferencePipeline:
    """
    3단 추론 파이프라인

    [Frame] → Gate → (OOD: stop) → Classify → (uncertain: AL queue) → Sequence → 확정

    - Gate: Anomaly Detection (PatchCore / EfficientNet)
    - Classify: ResNet 4-class
    - Sequence: State Machine T1→T2→T3→T4
    - 메트릭 실시간 추적
    - 에러 격리: 각 단계 예외를 잡아 다음 단계에 영향 없게 처리
    """

    def __init__(
        self,
        gate: BaseGateModel,
        classifier: BaseClassifierModel,
        state_machine: SequenceStateMachine,
    ) -> None:
        self.gate = gate
        self.classifier = classifier
        self.state_machine = state_machine
        self._lock = asyncio.Lock()

        # 콜백 (파이프라인 결과를 구독하는 외부 리스너)
        self._result_callbacks: list = []

        logger.info(
            "InferencePipeline initialized",
            gate=gate.name,
            classifier=classifier.name,
        )

    # ── 단계별 실행 ───────────────────────────────────────────────────────

    def _run_gate(self, gate: BaseGateModel, frame: np.ndarray) -> GateResult:
        try:
            return gate.predict(frame)
        except ModelNotLoadedError:
            raise
        except Exception as e:
            raise InferenceError("Gate inference failed", detail=str(e)) from e

    def _run_classify(self, classifier: BaseClassifierModel, frame: np.ndarray) -> ClassifyResult:
        try:
            return classifier.predict(frame)
        except ModelNotLoadedError:
            raise
        except Exception as e:
            raise InferenceError("Classify inference failed", detail=str(e)) from e

    def _run_sequence(self, target_id: int) -> SequenceResult:
        return self.state_machine.transition(target_id)

    # ── 메인 실행 ─────────────────────────────────────────────────────────

    async def run(self, frame: np.ndarray) -> InferenceResult:
        """
        단일 프레임에 대해 3단 파이프라인 실행 (비동기)

        프레임별 고유 ID를 부여하고 각 단계 결과를 기록.
        Gate에서 OOD면 Classify/Sequence 건너뜀 (조기 종료).
        """
        frame_id = str(uuid.uuid4())[:8]
        t_start = time.perf_counter()

        # Snapshot model references at frame boundary to avoid swap() race condition (H-1)
        gate = self.gate
        classifier = self.classifier

        bind_frame_context(frame_id, "gate", gate.name)

        gate_result: GateResult | None = None
        classify_result: ClassifyResult | None = None
        sequence_result: SequenceResult | None = None
        error_msg: str | None = None

        try:
            # ── 1단: Gate ─────────────────────────────
            gate_result = await asyncio.get_running_loop().run_in_executor(
                None, functools.partial(self._run_gate, gate, frame)
            )

            if not gate_result.is_target:
                # OOD → 조기 종료
                logger.debug(
                    "Gate: OOD detected",
                    score=round(gate_result.normalized_score, 3),
                    in_margin=gate_result.in_margin,
                )
            else:
                # ── 2단: Classify ─────────────────────
                bind_frame_context(frame_id, "classify", classifier.name)
                classify_result = await asyncio.get_running_loop().run_in_executor(
                    None, functools.partial(self._run_classify, classifier, frame)
                )

                logger.debug(
                    "Classify result",
                    target_id=classify_result.target_id,
                    confidence=round(classify_result.confidence, 3),
                    uncertain=classify_result.is_uncertain,
                )

                # ── 3단: Sequence ─────────────────────
                if not classify_result.is_uncertain:
                    bind_frame_context(frame_id, "sequence")
                    async with self._lock:
                        sequence_result = self._run_sequence(classify_result.target_id)

                    if sequence_result.accepted:
                        logger.info(
                            "Target CONFIRMED",
                            target_id=classify_result.target_id,
                            next_expected=sequence_result.next_expected,
                        )

        except (ModelNotLoadedError, InferenceError) as e:
            error_msg = str(e)
            logger.error("Pipeline error", error=error_msg, exc_info=True)
        except Exception as e:
            error_msg = f"Unexpected error: {e}"
            logger.error("Pipeline unexpected error", error=error_msg, exc_info=True)
        finally:
            clear_frame_context()

        total_ms = (time.perf_counter() - t_start) * 1000

        result = InferenceResult(
            frame_id=frame_id,
            gate_result=gate_result or GateResult(
                is_target=False, score=0.0, normalized_score=1.0,
                in_margin=False, model_name="unknown", latency_ms=0.0
            ),
            classify_result=classify_result,
            sequence_result=sequence_result,
            total_latency_ms=round(total_ms, 2),
            error=error_msg,
        )

        # 결과 콜백 호출 (M-1 fix: list() copy prevents ConcurrentModificationError)
        for cb in list(self._result_callbacks):
            try:
                await cb(result)
            except Exception as e:
                logger.warning("Result callback error", error=str(e))

        return result

    def run_sync(self, frame: np.ndarray) -> InferenceResult:
        """동기 래퍼 (테스트 / 배치 평가 전용).

        Warning (M-R7-1): asyncio 이벤트 루프가 이미 실행 ��인 환경(FastAPI/uvicorn)에서 호출하면
        RuntimeError: This event loop is already running 발생.
        프로덕션 코드에서는 async run()을 직접 호출하세요.
        """
        return asyncio.get_event_loop().run_until_complete(self.run(frame))

    # ── 모델 교체 ─────────────────────────────────────────────────────────

    async def swap_gate(self, new_gate: BaseGateModel) -> None:
        """런타임 중 Gate 모델 교체 — 락 보호로 추론 중 경쟁 조건 방지"""
        async with self._lock:
            old_name = self.gate.name
            self.gate = new_gate
        logger.info("Gate swapped", old=old_name, new=new_gate.name)

    async def swap_classifier(self, new_classifier: BaseClassifierModel) -> None:
        """런타임 중 Classifier 모델 교체 — 락 보호"""
        async with self._lock:
            old_name = self.classifier.name
            self.classifier = new_classifier
        logger.info("Classifier swapped", old=old_name, new=new_classifier.name)

    def reset_sequence(self) -> None:
        """State Machine 초기 상태로 리셋"""
        self.state_machine.reset()
        logger.info("Pipeline sequence reset")

    def undo_last_sequence(self):
        """마지막 시퀀스 전이 Undo"""
        return self.state_machine.undo_last()

    # ── 콜백 관리 ─────────────────────────────────────────────────────────

    def add_result_callback(self, cb) -> None:
        """추론 결과를 비동기로 수신할 콜백 등록"""
        self._result_callbacks.append(cb)

    def remove_result_callback(self, cb) -> None:
        self._result_callbacks = [c for c in self._result_callbacks if c is not cb]

    # ── 상태 조회 ──────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "gate": {
                "name": self.gate.name,
                "is_loaded": self.gate.is_loaded,
            },
            "classifier": {
                "name": self.classifier.name,
                "is_loaded": self.classifier.is_loaded,
            },
            "sequence": self.state_machine.to_dict(),
        }
