"""
EfficientNet-B 시리즈 기반 Gate 모델
- EfficientNet 피처 추출기 + 클러스터 기반 OOD 판별
- 각 Target 클래스별 피처 분포(Gaussian)를 구축하고
  Mahalanobis 거리로 이상 점수 계산
"""
from __future__ import annotations

import pickle
import time
from pathlib import Path

import numpy as np
import timm
import torch
import torchvision.transforms as T
from sklearn.covariance import EmpiricalCovariance

from backend.exceptions import ModelLoadError, ModelNotLoadedError, ModelSaveError
from backend.logging_config import get_logger
from backend.models.base import BaseGateModel, GateResult

logger = get_logger(__name__)


class EfficientNetGate(BaseGateModel):
    """
    EfficientNet-B 기반 OOD Gate

    동작 원리:
    1. timm의 EfficientNet-B 백본으로 전역 피처 추출 (global avg pool 출력)
    2. Target 이미지들의 피처 분포를 클래스별 Mahalanobis 파라미터로 저장
    3. 추론 시 입력 피처의 Mahalanobis 거리 계산
    4. 모든 클래스에 대한 최소 거리가 임계값 이하면 Target, 이상이면 OOD
    """

    VARIANTS = ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7"]

    def __init__(
        self,
        variant: str = "b3",
        in_threshold: float = 0.5,
        margin_low: float = 0.5,
        margin_high: float = 0.8,
        device: str | None = None,
    ) -> None:
        super().__init__(name=f"efficientnet_{variant}_gate")

        if variant not in self.VARIANTS:
            raise ValueError(f"Unsupported variant: {variant}")

        self.variant = variant
        self.in_threshold = in_threshold
        self.margin_low = margin_low
        self.margin_high = margin_high
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )

        # 백본 로드
        self._backbone = timm.create_model(
            f"efficientnet_{variant}",
            pretrained=True,
            num_classes=0,          # 헤드 제거 → 피처만 추출
            global_pool="avg",
        )
        self._backbone = self._backbone.to(self.device).eval()
        self._feat_dim = self._backbone.num_features

        # 클래스별 분포 파라미터
        self._class_means: dict[int, np.ndarray] = {}       # {class_id: mean_vec}
        self._class_covs: dict[int, np.ndarray] = {}         # {class_id: precision_matrix}
        self._score_stats: dict[str, float] = {}

        # 전처리 (EfficientNet 표준)
        cfg = timm.data.resolve_model_data_config(self._backbone)
        self._transform = timm.data.create_transform(**cfg, is_training=False)

        logger.info(
            "EfficientNetGate initialized",
            variant=variant,
            feat_dim=self._feat_dim,
            device=str(self.device),
        )

    # ── 피처 추출 ──────────────────────────────────────────────────────────

    @torch.no_grad()
    def _extract(self, image: np.ndarray) -> np.ndarray:
        tensor = self._transform(
            __import__("PIL").Image.fromarray(image)
        ).unsqueeze(0).to(self.device)
        feat = self._backbone(tensor)
        return feat.squeeze().cpu().numpy().astype(np.float32)

    @torch.no_grad()
    def _extract_batch(self, images: list[np.ndarray]) -> np.ndarray:
        pil = __import__("PIL").Image
        tensors = torch.stack([
            self._transform(pil.Image.fromarray(img)) for img in images
        ]).to(self.device)
        feats = self._backbone(tensors)
        return feats.cpu().numpy().astype(np.float32)

    # ── Mahalanobis 거리 ───────────────────────────────────────────────────

    def _mahalanobis(self, feat: np.ndarray, class_id: int) -> float:
        mu = self._class_means[class_id]
        prec = self._class_covs[class_id]
        diff = feat - mu
        return float(diff @ prec @ diff)

    def _min_mahalanobis(self, feat: np.ndarray) -> tuple[float, int]:
        """모든 클래스 중 최소 Mahalanobis 거리와 해당 클래스 반환"""
        scores = {
            cid: self._mahalanobis(feat, cid)
            for cid in self._class_means
        }
        best_cid = min(scores, key=scores.__getitem__)
        return scores[best_cid], best_cid

    # ── 핵심 메서드 ────────────────────────────────────────────────────────

    def fit(self, normal_images: list[np.ndarray], labels: list[int] | None = None) -> None:
        """
        Target 이미지로 클래스별 피처 분포 구축

        Args:
            normal_images: Target 이미지 목록
            labels: 각 이미지의 클래스 레이블 (None이면 전부 단일 클래스 0으로 처리)
        """
        if not normal_images:
            raise ValueError("No images provided for fitting")

        if labels is None:
            labels = [0] * len(normal_images)

        assert len(normal_images) == len(labels)

        logger.info("Building EfficientNet feature clusters", n_images=len(normal_images))
        t0 = time.time()

        # 전체 피처 추출
        chunk_size = 32
        all_feats: list[np.ndarray] = []
        for i in range(0, len(normal_images), chunk_size):
            chunk = normal_images[i : i + chunk_size]
            all_feats.append(self._extract_batch(chunk))
        all_feats_arr = np.vstack(all_feats)

        # 클래스별 분포 구축
        unique_classes = sorted(set(labels))
        all_scores: list[float] = []

        for cid in unique_classes:
            idxs = [i for i, l in enumerate(labels) if l == cid]
            class_feats = all_feats_arr[idxs]

            self._class_means[cid] = class_feats.mean(axis=0)

            # 공분산 역행렬 (precision matrix)
            cov_estimator = EmpiricalCovariance(assume_centered=False)
            cov_estimator.fit(class_feats)
            try:
                prec = cov_estimator.precision_
            except Exception:
                prec = np.eye(self._feat_dim)
            self._class_covs[cid] = prec

            # 정규화용 통계
            for feat in class_feats:
                score, _ = self._min_mahalanobis(feat)
                all_scores.append(score)

        scores_arr = np.array(all_scores)
        self._score_stats = {
            "min": float(scores_arr.min()),
            "max": float(scores_arr.max()),
        }

        self._is_loaded = True
        logger.info(
            "EfficientNet clusters built",
            n_classes=len(unique_classes),
            elapsed_s=round(time.time() - t0, 2),
        )

    def _normalize(self, raw: float) -> float:
        mn, mx = self._score_stats.get("min", 0), self._score_stats.get("max", 1)
        if mx == mn:
            return 0.0
        return float(np.clip((raw - mn) / (mx - mn), 0.0, 1.0))

    def predict(self, frame: np.ndarray) -> GateResult:
        if not self._is_loaded:
            raise ModelNotLoadedError("EfficientNetGate not fitted. Call fit() first.")

        t0 = time.perf_counter()
        feat = self._extract(frame)
        raw_score, _ = self._min_mahalanobis(feat)
        norm_score = self._normalize(raw_score)

        is_target = norm_score <= self.in_threshold
        in_margin = self.margin_low < norm_score <= self.margin_high
        latency = (time.perf_counter() - t0) * 1000

        return GateResult(
            is_target=is_target,
            score=raw_score,
            normalized_score=norm_score,
            in_margin=in_margin,
            model_name=self.name,
            latency_ms=round(latency, 2),
        )

    def predict_batch(self, frames: list[np.ndarray]) -> list[GateResult]:
        if not self._is_loaded:
            raise ModelNotLoadedError("EfficientNetGate not fitted")

        t0 = time.perf_counter()
        feats = self._extract_batch(frames)
        total_ms = (time.perf_counter() - t0) * 1000
        per_ms = total_ms / len(frames)

        results = []
        for feat in feats:
            raw, _ = self._min_mahalanobis(feat)
            norm = self._normalize(raw)
            results.append(GateResult(
                is_target=norm <= self.in_threshold,
                score=raw,
                normalized_score=norm,
                in_margin=self.margin_low < norm <= self.margin_high,
                model_name=self.name,
                latency_ms=round(per_ms, 2),
            ))
        return results

    def update(self, new_samples: list[np.ndarray], labels: list[int] | None = None) -> None:
        """AL 수집 샘플로 분포 업데이트 (재학습 방식)"""
        # 새 샘플을 추가해서 재fit하는 방식으로 처리
        logger.info("EfficientNetGate: incremental update (re-fitting)", n=len(new_samples))
        # 실제로는 기존 데이터와 합쳐서 재fit 해야 하므로 외부에서 관리
        if labels is None:
            labels = [0] * len(new_samples)
        new_feats = self._extract_batch(new_samples)
        for cid in set(labels):
            idxs = [i for i, l in enumerate(labels) if l == cid]
            if cid in self._class_means:
                # 기존 분포에 병합 (단순 평균 갱신)
                old_mean = self._class_means[cid]
                new_mean = new_feats[idxs].mean(axis=0)
                self._class_means[cid] = (old_mean + new_mean) / 2

    # ── 저장 / 로드 ────────────────────────────────────────────────────────

    def save(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        try:
            data = {
                "class_means": self._class_means,
                "class_covs": self._class_covs,
                "score_stats": self._score_stats,
                "config": {
                    "variant": self.variant,
                    "in_threshold": self.in_threshold,
                    "margin_low": self.margin_low,
                    "margin_high": self.margin_high,
                },
            }
            with open(path / "efficientnet_gate.pkl", "wb") as f:
                pickle.dump(data, f)
            logger.info("EfficientNetGate saved", path=str(path))
        except Exception as e:
            raise ModelSaveError("Failed to save EfficientNetGate", detail=str(e)) from e

    def load(self, path: Path) -> None:
        path = Path(path)
        try:
            with open(path / "efficientnet_gate.pkl", "rb") as f:
                data = pickle.load(f)
            self._class_means = data["class_means"]
            self._class_covs = data["class_covs"]
            self._score_stats = data["score_stats"]
            self._is_loaded = True
            logger.info("EfficientNetGate loaded", path=str(path))
        except Exception as e:
            raise ModelLoadError("Failed to load EfficientNetGate", detail=str(e)) from e
