"""
A/B 벤치마크 — Gate 모델 조합 정량 비교
PatchCore+ResNet vs EfficientNet+ResNet
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score,
    recall_score, roc_auc_score, confusion_matrix,
)

from backend.core.pipeline import InferencePipeline, InferenceResult
from backend.core.state_machine import SequenceStateMachine
from backend.logging_config import get_logger
from backend.models.base import BaseClassifierModel, BaseGateModel

logger = get_logger(__name__)


@dataclass
class PipelineMetrics:
    """단일 파이프라인 벤치마크 결과"""
    name: str
    gate_name: str
    classifier_name: str
    n_samples: int

    # Classification 지표
    accuracy: float
    f1_macro: float
    precision_macro: float
    recall_macro: float

    # Gate 지표
    gate_tpr: float          # True Positive Rate (Target 정상 검출율)
    gate_tnr: float          # True Negative Rate (OOD 정상 제거율)
    gate_fpr: float          # False Positive Rate (OOD가 Gate 통과한 비율)

    # Latency
    avg_total_ms: float
    p50_total_ms: float
    p95_total_ms: float
    p99_total_ms: float
    avg_gate_ms: float
    avg_classify_ms: float

    # 기타
    gate_pass_rate: float
    confusion_matrix: list[list[int]]
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "gate_name": self.gate_name,
            "classifier_name": self.classifier_name,
            "n_samples": self.n_samples,
            "accuracy": round(self.accuracy, 4),
            "f1_macro": round(self.f1_macro, 4),
            "precision_macro": round(self.precision_macro, 4),
            "recall_macro": round(self.recall_macro, 4),
            "gate_tpr": round(self.gate_tpr, 4),
            "gate_tnr": round(self.gate_tnr, 4),
            "gate_fpr": round(self.gate_fpr, 4),
            "avg_total_ms": round(self.avg_total_ms, 2),
            "p50_total_ms": round(self.p50_total_ms, 2),
            "p95_total_ms": round(self.p95_total_ms, 2),
            "p99_total_ms": round(self.p99_total_ms, 2),
            "avg_gate_ms": round(self.avg_gate_ms, 2),
            "avg_classify_ms": round(self.avg_classify_ms, 2),
            "gate_pass_rate": round(self.gate_pass_rate, 4),
            "confusion_matrix": self.confusion_matrix,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class BenchmarkReport:
    """A vs B 비교 보고서"""
    pipeline_a: PipelineMetrics
    pipeline_b: PipelineMetrics
    winner: str                   # "A" | "B" | "TIE"
    winner_reason: str
    timestamp: datetime = field(default_factory=datetime.now)

    def summary(self) -> dict:
        return {
            "pipeline_a": self.pipeline_a.to_dict(),
            "pipeline_b": self.pipeline_b.to_dict(),
            "winner": self.winner,
            "winner_reason": self.winner_reason,
            "comparison": {
                "accuracy_diff": round(
                    self.pipeline_a.accuracy - self.pipeline_b.accuracy, 4
                ),
                "f1_diff": round(
                    self.pipeline_a.f1_macro - self.pipeline_b.f1_macro, 4
                ),
                "latency_diff_ms": round(
                    self.pipeline_a.avg_total_ms - self.pipeline_b.avg_total_ms, 2
                ),
                "gate_fpr_diff": round(
                    self.pipeline_a.gate_fpr - self.pipeline_b.gate_fpr, 4
                ),
            },
            "timestamp": self.timestamp.isoformat(),
        }


class BenchmarkRunner:
    """
    두 파이프라인 조합을 동일 데이터셋으로 평가해 정량 비교

    평가 지표:
    - Accuracy / F1(macro) / Precision / Recall (분류 성능)
    - Gate TPR / TNR / FPR (Gate 필터 성능)
    - Latency: avg, P50, P95, P99 (속도)

    승자 결정 기준:
    - F1 + (1/latency) 종합 점수 가중합
    """

    def __init__(
        self,
        pipeline_a_name: str = "PatchCore+ResNet",
        pipeline_b_name: str = "EfficientNet+ResNet",
        warmup_runs: int = 5,
    ) -> None:
        self.pipeline_a_name = pipeline_a_name
        self.pipeline_b_name = pipeline_b_name
        self.warmup_runs = warmup_runs

    async def evaluate_pipeline(
        self,
        pipeline: InferencePipeline,
        name: str,
        test_images: list[np.ndarray],
        test_labels: list[int],           # 0-indexed classify label
        test_is_target: list[bool],       # Gate ground truth
    ) -> PipelineMetrics:
        """단일 파이프라인 평가"""
        logger.info("Evaluating pipeline", name=name, n_samples=len(test_images))

        # Warmup
        for img in test_images[:self.warmup_runs]:
            await pipeline.run(img)

        pipeline.reset_sequence()

        results: list[InferenceResult] = []
        for img in test_images:
            r = await pipeline.run(img)
            results.append(r)

        return self._compute_metrics(name, pipeline, results, test_labels, test_is_target)

    def _compute_metrics(
        self,
        name: str,
        pipeline: InferencePipeline,
        results: list[InferenceResult],
        true_labels: list[int],
        true_is_target: list[bool],
    ) -> PipelineMetrics:
        n = len(results)

        # Latency
        total_lats = np.array([r.total_latency_ms for r in results])
        gate_lats = np.array([r.gate_result.latency_ms for r in results])
        classify_lats = np.array([
            r.classify_result.latency_ms if r.classify_result else 0.0
            for r in results
        ])

        # Gate 성능
        pred_is_target = [r.gate_result.is_target for r in results]
        tp = sum(p and t for p, t in zip(pred_is_target, true_is_target))
        tn = sum(not p and not t for p, t in zip(pred_is_target, true_is_target))
        fp = sum(p and not t for p, t in zip(pred_is_target, true_is_target))
        fn = sum(not p and t for p, t in zip(pred_is_target, true_is_target))

        gate_tpr = tp / max(tp + fn, 1)
        gate_tnr = tn / max(tn + fp, 1)
        gate_fpr = fp / max(fp + tn, 1)

        # Classification 성능 (Gate 통과 + label 있는 것만)
        classify_pairs = [
            (r.classify_result.target_id - 1, gt)
            for r, gt in zip(results, true_labels)
            if r.classify_result is not None and gt >= 0
        ]

        if classify_pairs:
            y_pred, y_true = zip(*classify_pairs)
            accuracy = float(accuracy_score(y_true, y_pred))
            f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
            precision = float(precision_score(y_true, y_pred, average="macro", zero_division=0))
            recall = float(recall_score(y_true, y_pred, average="macro", zero_division=0))
            cm = confusion_matrix(y_true, y_pred, labels=[0, 1, 2, 3]).tolist()
        else:
            accuracy = f1 = precision = recall = 0.0
            cm = []

        gate_pass_rate = sum(pred_is_target) / n

        return PipelineMetrics(
            name=name,
            gate_name=pipeline.gate.name,
            classifier_name=pipeline.classifier.name,
            n_samples=n,
            accuracy=accuracy,
            f1_macro=f1,
            precision_macro=precision,
            recall_macro=recall,
            gate_tpr=gate_tpr,
            gate_tnr=gate_tnr,
            gate_fpr=gate_fpr,
            avg_total_ms=float(total_lats.mean()),
            p50_total_ms=float(np.percentile(total_lats, 50)),
            p95_total_ms=float(np.percentile(total_lats, 95)),
            p99_total_ms=float(np.percentile(total_lats, 99)),
            avg_gate_ms=float(gate_lats.mean()),
            avg_classify_ms=float(classify_lats[classify_lats > 0].mean()) if classify_lats.any() else 0.0,
            gate_pass_rate=gate_pass_rate,
            confusion_matrix=cm,
        )

    def _determine_winner(
        self, a: PipelineMetrics, b: PipelineMetrics
    ) -> tuple[str, str]:
        """
        종합 점수로 승자 결정
        score = 0.5 * F1 + 0.3 * (1 - gate_fpr) + 0.2 * speed_score
        """
        max_lat = max(a.avg_total_ms, b.avg_total_ms, 1.0)
        speed_a = 1.0 - (a.avg_total_ms / max_lat)
        speed_b = 1.0 - (b.avg_total_ms / max_lat)

        score_a = 0.5 * a.f1_macro + 0.3 * (1 - a.gate_fpr) + 0.2 * speed_a
        score_b = 0.5 * b.f1_macro + 0.3 * (1 - b.gate_fpr) + 0.2 * speed_b

        diff = abs(score_a - score_b)
        if diff < 0.01:
            return "TIE", f"Scores within margin: A={score_a:.3f}, B={score_b:.3f}"
        elif score_a > score_b:
            return "A", (
                f"A wins (score: {score_a:.3f} vs {score_b:.3f}) | "
                f"F1: {a.f1_macro:.3f} vs {b.f1_macro:.3f} | "
                f"Latency: {a.avg_total_ms:.1f}ms vs {b.avg_total_ms:.1f}ms"
            )
        else:
            return "B", (
                f"B wins (score: {score_b:.3f} vs {score_a:.3f}) | "
                f"F1: {b.f1_macro:.3f} vs {a.f1_macro:.3f} | "
                f"Latency: {b.avg_total_ms:.1f}ms vs {a.avg_total_ms:.1f}ms"
            )

    async def run(
        self,
        pipeline_a: InferencePipeline,
        pipeline_b: InferencePipeline,
        test_images: list[np.ndarray],
        test_labels: list[int],
        test_is_target: list[bool],
    ) -> BenchmarkReport:
        """A vs B 전체 벤치마크 실행"""
        logger.info(
            "Benchmark started",
            pipeline_a=self.pipeline_a_name,
            pipeline_b=self.pipeline_b_name,
            n_samples=len(test_images),
        )

        metrics_a = await self.evaluate_pipeline(
            pipeline_a, self.pipeline_a_name,
            test_images, test_labels, test_is_target,
        )
        metrics_b = await self.evaluate_pipeline(
            pipeline_b, self.pipeline_b_name,
            test_images, test_labels, test_is_target,
        )

        winner, reason = self._determine_winner(metrics_a, metrics_b)
        report = BenchmarkReport(
            pipeline_a=metrics_a,
            pipeline_b=metrics_b,
            winner=winner,
            winner_reason=reason,
        )

        logger.info(
            "Benchmark complete",
            winner=winner,
            reason=reason,
        )
        return report
