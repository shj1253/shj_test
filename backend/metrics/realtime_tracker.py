"""
실시간 메트릭 추적기 — 슬라이딩 윈도우 기반
Accuracy, F1, Precision, Recall, Latency 실시간 계산
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    confusion_matrix,
)

from backend.core.pipeline import InferenceResult
from backend.logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class MetricsSnapshot:
    timestamp: datetime
    window_size: int
    accuracy: float
    f1: float
    precision: float
    recall: float
    avg_latency_ms: float
    p95_latency_ms: float
    gate_pass_rate: float          # Gate 통과율 (Target 비율)
    al_queue_size: int = 0
    confirmed_count: int = 0       # 시퀀스 확정 건수
    confusion_matrix: list[list[int]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "window_size": self.window_size,
            "accuracy": round(self.accuracy, 4),
            "f1": round(self.f1, 4),
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "avg_latency_ms": round(self.avg_latency_ms, 2),
            "p95_latency_ms": round(self.p95_latency_ms, 2),
            "gate_pass_rate": round(self.gate_pass_rate, 4),
            "al_queue_size": self.al_queue_size,
            "confirmed_count": self.confirmed_count,
            "confusion_matrix": self.confusion_matrix,
        }


class RealtimeMetricsTracker:
    """
    슬라이딩 윈도우 기반 실시간 메트릭 계산기

    - 매 프레임 InferenceResult를 기록
    - ground_truth가 있으면 Accuracy/F1/Precision/Recall 계산
    - 없으면 Latency/PassRate만 추적
    - 최근 window_size 프레임 기준으로만 계산
    """

    def __init__(self, window_size: int = 100) -> None:
        self.window_size = window_size
        self._results: deque[InferenceResult] = deque(maxlen=window_size)
        self._labels: deque[int | None] = deque(maxlen=window_size)
        self._confirmed_count: int = 0
        self._session_start = datetime.now()
        self._al_queue_size: int = 0

    def record(
        self,
        result: InferenceResult,
        ground_truth: int | None = None,
    ) -> None:
        """
        추론 결과 기록

        Args:
            result: InferenceResult
            ground_truth: 0-indexed 정답 레이블 (없으면 None)
        """
        self._results.append(result)
        self._labels.append(ground_truth)
        if result.is_confirmed:
            self._confirmed_count += 1

    def update_al_queue_size(self, size: int) -> None:
        self._al_queue_size = size

    @property
    def current_metrics(self) -> MetricsSnapshot:
        """현재 슬라이딩 윈도우 기준 메트릭 스냅샷"""
        n = len(self._results)
        if n == 0:
            return self._empty_snapshot()

        results = list(self._results)
        labels = list(self._labels)

        # Latency
        latencies = [r.total_latency_ms for r in results]
        avg_lat = float(np.mean(latencies))
        p95_lat = float(np.percentile(latencies, 95))

        # Gate 통과율
        gate_pass = sum(1 for r in results if r.gate_result.is_target) / n

        # Classification 지표 (ground_truth 있는 것만)
        labeled_pairs = [
            (r, gt)
            for r, gt in zip(results, labels)
            if gt is not None and r.classify_result is not None
        ]

        accuracy, f1, precision, recall = 0.0, 0.0, 0.0, 0.0
        cm: list[list[int]] = []

        if labeled_pairs:
            y_true = [gt for _, gt in labeled_pairs]
            y_pred = [r.classify_result.target_id - 1 for r, _ in labeled_pairs]  # 0-indexed

            try:
                accuracy = float(accuracy_score(y_true, y_pred))
                f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
                precision = float(
                    precision_score(y_true, y_pred, average="macro", zero_division=0)
                )
                recall = float(
                    recall_score(y_true, y_pred, average="macro", zero_division=0)
                )
                cm = confusion_matrix(y_true, y_pred, labels=list(range(4))).tolist()
            except Exception as e:
                logger.warning("Metrics calculation failed", error=str(e))

        return MetricsSnapshot(
            timestamp=datetime.now(),
            window_size=n,
            accuracy=accuracy,
            f1=f1,
            precision=precision,
            recall=recall,
            avg_latency_ms=avg_lat,
            p95_latency_ms=p95_lat,
            gate_pass_rate=gate_pass,
            al_queue_size=self._al_queue_size,
            confirmed_count=self._confirmed_count,
            confusion_matrix=cm,
        )

    def get_history(self, n: int = 50) -> list[dict]:
        """최근 n개 결과 dict 리스트"""
        results = list(self._results)[-n:]
        return [r.to_dict() for r in results]

    def _empty_snapshot(self) -> MetricsSnapshot:
        return MetricsSnapshot(
            timestamp=datetime.now(),
            window_size=0,
            accuracy=0.0, f1=0.0, precision=0.0, recall=0.0,
            avg_latency_ms=0.0, p95_latency_ms=0.0,
            gate_pass_rate=0.0,
            al_queue_size=self._al_queue_size,
            confirmed_count=self._confirmed_count,
        )

    def reset(self) -> None:
        self._results.clear()
        self._labels.clear()
        self._confirmed_count = 0
        self._session_start = datetime.now()

    @property
    def session_info(self) -> dict:
        return {
            "session_start": self._session_start.isoformat(),
            "total_frames": len(self._results),
            "confirmed_count": self._confirmed_count,
        }
