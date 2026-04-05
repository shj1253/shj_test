"""
실시간 메트릭 추적기 — 슬라이딩 윈도우 기반
파이프라인 전 단계 KPI 실시간 계산
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    confusion_matrix,
    roc_auc_score,
)

from backend.core.pipeline import InferenceResult
from backend.logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class MetricsSnapshot:
    timestamp: datetime
    window_size: int

    # ── 기본 분류 지표 ────────────────────────────────────────────────────
    accuracy: float
    f1: float
    precision: float
    recall: float
    confusion_matrix: list[list[int]] = field(default_factory=list)

    # 클래스별 F1 (Macro F1 세부)
    per_class_f1: list[float] = field(default_factory=list)
    # 클래스별 CM 대각 비율 (TP/row_sum per class)
    cm_diagonal_ratio: list[float] = field(default_factory=list)

    # ── 레이턴시 ─────────────────────────────────────────────────────────
    avg_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    gate_latency_avg_ms: float = 0.0   # Stage 2 처리 지연
    gate_latency_p95_ms: float = 0.0
    classify_latency_avg_ms: float = 0.0  # Stage 3 추론 지연 (P95)
    classify_latency_p95_ms: float = 0.0

    # ── Stage 2: 이상 탐지 ────────────────────────────────────────────────
    gate_pass_rate: float = 0.0        # 통과율 (10~40% 목표)
    ood_recall: float = 0.0            # OOD Recall (GT 있을 때만)
    auroc: float = 0.0                 # AUROC (GT 있을 때만)

    # ── Stage 3: 분류 ─────────────────────────────────────────────────────
    low_confidence_ratio: float = 0.0  # 낮은 신뢰도 샘플 비율 (≤5% 목표)
    ece: float = 0.0                   # Expected Calibration Error (GT 있을 때만)

    # ── Stage 4: State Machine ────────────────────────────────────────────
    sequence_error_rate: float = 0.0   # 순서 오류율 (≤1% 목표)
    false_block_rate: float = 0.0      # False Block Rate (≤0.5% 목표)
    sequence_completion_rate: float = 0.0  # 시퀀스 완주율 (≥99% 목표)
    e2e_latency_ms: float = 0.0        # 알림 E2E 지연 (≤200ms 목표)
    system_precision: float = 0.0      # 시스템 수준 정밀도 (≥0.99 목표)

    # ── Active Learning ───────────────────────────────────────────────────
    al_queue_size: int = 0
    confirmed_count: int = 0
    psi_score: float = 0.0             # Population Stability Index (>0.2 = drift)
    al_query_hit_rate: float = 0.0     # 쿼리 적중률

    # GT 존재 여부 (H-2 fix: used by KPI reporter instead of accuracy > 0 heuristic)
    has_gt: bool = False

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "window_size": self.window_size,
            # 기본
            "accuracy": round(self.accuracy, 4),
            "f1": round(self.f1, 4),
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "confusion_matrix": self.confusion_matrix,
            "per_class_f1": [round(v, 4) for v in self.per_class_f1],
            "cm_diagonal_ratio": [round(v, 4) for v in self.cm_diagonal_ratio],
            # 레이턴시
            "avg_latency_ms": round(self.avg_latency_ms, 2),
            "p95_latency_ms": round(self.p95_latency_ms, 2),
            "gate_latency_avg_ms": round(self.gate_latency_avg_ms, 2),
            "gate_latency_p95_ms": round(self.gate_latency_p95_ms, 2),
            "classify_latency_avg_ms": round(self.classify_latency_avg_ms, 2),
            "classify_latency_p95_ms": round(self.classify_latency_p95_ms, 2),
            # Stage 2
            "gate_pass_rate": round(self.gate_pass_rate, 4),
            "ood_recall": round(self.ood_recall, 4),
            "auroc": round(self.auroc, 4),
            # Stage 3
            "low_confidence_ratio": round(self.low_confidence_ratio, 4),
            "ece": round(self.ece, 4),
            # Stage 4
            "sequence_error_rate": round(self.sequence_error_rate, 4),
            "false_block_rate": round(self.false_block_rate, 4),
            "sequence_completion_rate": round(self.sequence_completion_rate, 4),
            "e2e_latency_ms": round(self.e2e_latency_ms, 2),
            "system_precision": round(self.system_precision, 4),
            # AL
            "al_queue_size": self.al_queue_size,
            "confirmed_count": self.confirmed_count,
            "psi_score": round(self.psi_score, 4),
            "al_query_hit_rate": round(self.al_query_hit_rate, 4),
            # GT flag
            "has_gt": self.has_gt,
        }


class RealtimeMetricsTracker:
    """
    슬라이딩 윈도우 기반 실시간 KPI 계산기

    - 매 프레임 InferenceResult를 기록
    - 파이프라인 전 단계 KPI 실시간 추적
    - ground_truth 없이도 레이턴시·통과율·불확실 비율 추적
    - GT 있으면 Accuracy/F1/OOD Recall/ECE/AUROC 계산

    Thread safety (C-5): record() is designed for single asyncio task use only.
    All callers must be in the same event loop thread. If mixing with threading,
    add an asyncio.Lock around record() at the call site.
    """

    def __init__(self, window_size: int = 200) -> None:
        self.window_size = window_size

        self._results: deque[InferenceResult] = deque(maxlen=window_size)
        self._labels: deque[Optional[int]] = deque(maxlen=window_size)

        # 레이턴시 windowed
        self._gate_lats: deque[float] = deque(maxlen=window_size)
        self._classify_lats: deque[float] = deque(maxlen=window_size)

        # 세션 누적 카운터 (리셋 전까지)
        self._confirmed_count: int = 0
        self._session_start = datetime.now()
        self._al_queue_size: int = 0

        # Stage 4 누적
        self._seq_transitions_total: int = 0   # 시퀀스 전이 시도 총 수
        self._seq_violations: int = 0          # 순서 위반 수
        self._seq_started: int = 0             # T1 감지 세션 수
        self._seq_completed: int = 0           # 완주 세션 수
        self._false_blocks: int = 0            # False block 추정 수
        self._true_sequences: int = 0          # 정상 시퀀스 수
        self._in_sequence: bool = False        # T1 확정 후 완주/위반 전까지 True

        # E2E 레이턴시
        self._e2e_latencies: deque[float] = deque(maxlen=50)

        # PSI 기준 분포 (Gate score)
        self._baseline_gate_scores: list[float] | None = None
        self._current_gate_scores: deque[float] = deque(maxlen=200)

        # AL query hit
        self._al_queries: int = 0
        self._al_hits: int = 0          # 쿼리 중 실제 오분류였던 수

        # 신뢰도 보정 (ECE 계산용) — IMP-2 fix: deque(maxlen) 으로 무제한 누적 방지
        self._conf_bins: list[deque] = [deque(maxlen=window_size) for _ in range(10)]
        self._acc_bins: list[deque] = [deque(maxlen=window_size) for _ in range(10)]

    def record(
        self,
        result: InferenceResult,
        ground_truth: Optional[int] = None,
    ) -> None:
        """추론 결과 기록 (ground_truth: 0-indexed, None이면 레이블 없음)"""
        self._results.append(result)
        self._labels.append(ground_truth)

        # Gate 레이턴시
        if result.gate_result:
            self._gate_lats.append(result.gate_result.latency_ms)
            self._current_gate_scores.append(result.gate_result.normalized_score)

            # M-3 fix: auto-set PSI baseline after first full window (no manual call needed)
            if (self._baseline_gate_scores is None
                    and len(self._current_gate_scores) >= self.window_size):
                self._baseline_gate_scores = list(self._current_gate_scores)
                logger.info("PSI baseline auto-set", n=len(self._baseline_gate_scores))

        # Classify 레이턴시 + 불확실
        if result.classify_result:
            self._classify_lats.append(result.classify_result.latency_ms)

            # C-1 fix: ECE 누적 — conf/acc must be appended together (GT-only)
            # Appending conf without acc creates bin size mismatch → wrong ECE
            if ground_truth is not None:
                conf = result.classify_result.confidence
                bin_idx = min(int(conf * 10), 9)
                # M-R6-1 fix: guard against target_id=0 edge case (model contract: 1-indexed)
                pred_0idx = max(0, result.classify_result.target_id - 1)
                self._conf_bins[bin_idx].append(conf)
                self._acc_bins[bin_idx].append(int(pred_0idx == ground_truth))

            # AL query
            if result.classify_result.is_uncertain:
                self._al_queries += 1
                if ground_truth is not None:
                    pred_0idx = max(0, result.classify_result.target_id - 1)
                    if pred_0idx != ground_truth:
                        self._al_hits += 1

        # State Machine 이벤트
        if result.sequence_result:
            self._seq_transitions_total += 1
            if result.sequence_result.accepted:
                # T1 시작 감지 (T1 accepted → 시퀀스 시작)
                if (result.classify_result and result.classify_result.target_id == 1):
                    self._seq_started += 1
                    self._in_sequence = True
            else:
                # 순서 위반
                self._seq_violations += 1
                # 시퀀스 진행 중 위반 = false block (정상 진행 중 불합리하게 차단됨)
                if self._in_sequence:
                    self._false_blocks += 1
                    self._in_sequence = False

        # 시퀀스 완주 감지
        if result.is_confirmed:
            self._confirmed_count += 1
            if result.sequence_result and result.sequence_result.current_state == "COMPLETE":
                self._seq_completed += 1
                self._true_sequences += 1  # 정상 완주 = true sequence 카운트
                self._in_sequence = False  # 완주로 시퀀스 종료

    def record_e2e_latency(self, latency_ms: float) -> None:
        """알림 E2E 레이턴시 기록 (StreamManager에서 호출)"""
        self._e2e_latencies.append(latency_ms)

    def update_al_queue_size(self, size: int) -> None:
        self._al_queue_size = size

    def set_baseline_gate_scores(self, scores: list[float]) -> None:
        """PSI 기준 분포 설정 (최초 학습 후 호출)"""
        self._baseline_gate_scores = scores

    @property
    def current_metrics(self) -> MetricsSnapshot:
        n = len(self._results)
        if n == 0:
            return self._empty_snapshot()

        results = list(self._results)
        labels = list(self._labels)

        # ── 전체 레이턴시 ─────────────────────────────────────────────────
        total_lats = [r.total_latency_ms for r in results]
        avg_lat = float(np.mean(total_lats))
        p95_lat = float(np.percentile(total_lats, 95))

        # Gate 레이턴시
        gate_lats = list(self._gate_lats)
        gate_avg = float(np.mean(gate_lats)) if gate_lats else 0.0
        gate_p95 = float(np.percentile(gate_lats, 95)) if gate_lats else 0.0

        # Classify 레이턴시
        cls_lats = list(self._classify_lats)
        cls_avg = float(np.mean(cls_lats)) if cls_lats else 0.0
        cls_p95 = float(np.percentile(cls_lats, 95)) if cls_lats else 0.0

        # ── Stage 2: Gate ─────────────────────────────────────────────────
        # H-R8-1 fix: guard against gate_result=None (e.g. in unit tests or direct record() calls)
        gate_pass_count = sum(1 for r in results if r.gate_result and r.gate_result.is_target)
        gate_pass_rate = gate_pass_count / n

        # ── Stage 3: 분류 ─────────────────────────────────────────────────
        classified = [r for r in results if r.classify_result is not None]
        n_cls = len(classified)
        low_conf_ratio = (
            sum(1 for r in classified if r.classify_result.is_uncertain) / n_cls
            if n_cls > 0 else 0.0
        )

        # Ground-truth 기반 지표
        accuracy, f1, precision, recall = 0.0, 0.0, 0.0, 0.0
        per_class_f1: list[float] = []
        cm: list[list[int]] = []
        cm_diag: list[float] = []
        ood_recall, auroc, ece = 0.0, 0.0, 0.0

        labeled_pairs = [
            (r, gt)
            for r, gt in zip(results, labels)
            if gt is not None and r.classify_result is not None
        ]

        # H-R6-2 fix: has_gt = classification GT exists (not just OOD GT=−1).
        # OOD-only GT would set has_gt=True but f1=0 → false "fail" KPI alarms.
        has_gt = len(labeled_pairs) > 0

        # GT 있는 경우 분류 지표
        if labeled_pairs:
            y_true = [gt for _, gt in labeled_pairs]
            # H-R7-2 fix: same max(0,...) guard as record() — target_id is 1-indexed by contract
            y_pred = [max(0, r.classify_result.target_id - 1) for r, _ in labeled_pairs]
            try:
                accuracy = float(accuracy_score(y_true, y_pred))
                f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
                precision = float(precision_score(y_true, y_pred, average="macro", zero_division=0))
                recall = float(recall_score(y_true, y_pred, average="macro", zero_division=0))
                per_class_f1 = list(f1_score(y_true, y_pred, average=None, zero_division=0))

                # M-R8-3 fix: always 4×4 CM (T1~T4 fixed) — prevents cm_diag from exceeding 4 entries
                cm_raw = confusion_matrix(y_true, y_pred, labels=list(range(4))).tolist()
                cm = cm_raw
                # 대각 비율 (정답 비율 per class)
                cm_diag = []
                for i, row in enumerate(cm_raw):
                    row_sum = sum(row)
                    cm_diag.append(cm_raw[i][i] / row_sum if row_sum > 0 else 0.0)
            except Exception as e:
                logger.warning("Classification metrics failed", error=str(e))

        # OOD recall + AUROC (GT 있는 경우)
        ood_gt_pairs = [
            (r, gt)
            for r, gt in zip(results, labels)
            if gt is not None
        ]
        if ood_gt_pairs and len(ood_gt_pairs) >= 10:
            try:
                y_ood_true = [int(gt < 0) for _, gt in ood_gt_pairs]  # gt=-1 = OOD
                y_ood_score = [1 - r.gate_result.normalized_score for r, _ in ood_gt_pairs]
                if sum(y_ood_true) > 0 and sum(1 - v for v in y_ood_true) > 0:
                    auroc = float(roc_auc_score(y_ood_true, y_ood_score))
                tp_ood = sum(1 for r, gt in ood_gt_pairs if gt < 0 and not r.gate_result.is_target)
                fn_ood = sum(1 for r, gt in ood_gt_pairs if gt < 0 and r.gate_result.is_target)
                if tp_ood + fn_ood > 0:
                    ood_recall = tp_ood / (tp_ood + fn_ood)
            except Exception:
                pass

        # ECE
        ece = self._compute_ece()

        # ── Stage 4: State Machine ────────────────────────────────────────
        seq_error_rate = (
            self._seq_violations / self._seq_transitions_total
            if self._seq_transitions_total > 0 else 0.0
        )
        false_block_rate = (
            self._false_blocks / max(1, self._true_sequences + self._false_blocks)
        )
        seq_completion_rate = (
            self._seq_completed / self._seq_started
            if self._seq_started > 0 else 0.0
        )
        e2e_lats = list(self._e2e_latencies)
        e2e_avg = float(np.mean(e2e_lats)) if e2e_lats else 0.0

        # 시스템 수준 정밀도 (알림 발송된 것 중 정상 완주)
        sys_precision = (
            self._seq_completed / max(1, self._confirmed_count)
        )

        # ── PSI ──────────────────────────────────────────────────────────
        psi = self._compute_psi()

        # AL 쿼리 적중률
        al_hit_rate = (
            self._al_hits / self._al_queries
            if self._al_queries > 0 else 0.0
        )

        return MetricsSnapshot(
            timestamp=datetime.now(),
            window_size=n,
            # 기본
            accuracy=accuracy,
            f1=f1,
            precision=precision,
            recall=recall,
            confusion_matrix=cm,
            per_class_f1=per_class_f1,
            cm_diagonal_ratio=cm_diag,
            # 레이턴시
            avg_latency_ms=avg_lat,
            p95_latency_ms=p95_lat,
            gate_latency_avg_ms=gate_avg,
            gate_latency_p95_ms=gate_p95,
            classify_latency_avg_ms=cls_avg,
            classify_latency_p95_ms=cls_p95,
            # Stage 2
            gate_pass_rate=gate_pass_rate,
            ood_recall=ood_recall,
            auroc=auroc,
            # Stage 3
            low_confidence_ratio=low_conf_ratio,
            ece=ece,
            # Stage 4
            sequence_error_rate=seq_error_rate,
            false_block_rate=false_block_rate,
            sequence_completion_rate=seq_completion_rate,
            e2e_latency_ms=e2e_avg,
            system_precision=sys_precision,
            # AL
            al_queue_size=self._al_queue_size,
            confirmed_count=self._confirmed_count,
            psi_score=psi,
            al_query_hit_rate=al_hit_rate,
            has_gt=has_gt,
        )

    def _compute_ece(self) -> float:
        """Expected Calibration Error (GT 있는 빈만 계산, 슬라이딩 윈도우)"""
        total_samples = 0
        ece = 0.0
        for conf_list, acc_list in zip(self._conf_bins, self._acc_bins):
            if not acc_list:
                continue
            n = len(acc_list)
            avg_conf = float(np.mean(list(conf_list)))
            avg_acc = float(np.mean(list(acc_list)))
            ece += n * abs(avg_acc - avg_conf)
            total_samples += n
        return ece / total_samples if total_samples > 0 else 0.0

    def _compute_psi(self) -> float:
        """PSI (Population Stability Index) — Gate score 분포 변화"""
        if self._baseline_gate_scores is None or len(self._current_gate_scores) < 30:
            return 0.0
        try:
            bins = np.linspace(0, 1, 11)
            baseline_hist, _ = np.histogram(self._baseline_gate_scores, bins=bins)
            current_hist, _ = np.histogram(list(self._current_gate_scores), bins=bins)
            baseline_pct = (baseline_hist + 1e-6) / (sum(baseline_hist) + 1e-6)
            current_pct = (current_hist + 1e-6) / (sum(current_hist) + 1e-6)
            psi = float(np.sum((current_pct - baseline_pct) * np.log(current_pct / baseline_pct)))
            return psi
        except Exception:
            return 0.0

    def get_history(self, n: int = 50) -> list[dict]:
        return [r.to_dict() for r in list(self._results)[-n:]]

    def _empty_snapshot(self) -> MetricsSnapshot:
        return MetricsSnapshot(
            timestamp=datetime.now(),
            window_size=0,
            accuracy=0.0, f1=0.0, precision=0.0, recall=0.0,
            al_queue_size=self._al_queue_size,
            confirmed_count=self._confirmed_count,
        )

    def reset(self) -> None:
        self._results.clear()
        self._labels.clear()
        self._gate_lats.clear()
        self._classify_lats.clear()
        self._confirmed_count = 0
        self._seq_transitions_total = 0
        self._seq_violations = 0
        self._seq_started = 0
        self._seq_completed = 0
        self._false_blocks = 0
        self._true_sequences = 0
        self._in_sequence = False
        self._e2e_latencies.clear()
        self._al_queries = 0
        self._al_hits = 0
        self._conf_bins = [deque(maxlen=self.window_size) for _ in range(10)]
        self._acc_bins = [deque(maxlen=self.window_size) for _ in range(10)]
        self._current_gate_scores.clear()
        self._session_start = datetime.now()

    @property
    def session_info(self) -> dict:
        return {
            "session_start": self._session_start.isoformat(),
            "total_frames": len(self._results),
            "confirmed_count": self._confirmed_count,
        }
