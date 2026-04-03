"""
PatchCore Gate 모델
- WideResNet50 / ResNet18 백본으로 패치 피처 추출
- faiss IVFFlat 메모리 뱅크로 최근접 거리 계산
- 임계값으로 Target / OOD 판별
"""
from __future__ import annotations

import pickle
import time
from pathlib import Path
from typing import Any

import faiss
import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms as T
from torchvision import models

from backend.exceptions import ModelLoadError, ModelNotLoadedError, ModelSaveError
from backend.logging_config import get_logger
from backend.models.base import BaseGateModel, GateResult

logger = get_logger(__name__)


class PatchCoreModel(BaseGateModel):
    """
    PatchCore 기반 Anomaly Detection Gate

    동작 원리:
    1. 사전학습된 CNN 백본으로 중간층 패치 피처 추출
    2. 추출된 피처를 faiss 메모리 뱅크에 저장
    3. 추론 시 입력 피처와 메모리 뱅크 최근접 거리로 이상 점수 계산
    4. 임계값 이하면 In-distribution (Target), 이상이면 OOD
    """

    SUPPORTED_BACKBONES = {
        "resnet18": (models.resnet18, models.ResNet18_Weights.IMAGENET1K_V1),
        "resnet50": (models.resnet50, models.ResNet50_Weights.IMAGENET1K_V2),
        "wide_resnet50_2": (
            models.wide_resnet50_2,
            models.Wide_ResNet50_2_Weights.IMAGENET1K_V2,
        ),
    }

    def __init__(
        self,
        backbone: str = "wide_resnet50_2",
        layers: list[str] | None = None,
        n_neighbors: int = 9,
        in_threshold: float = 0.5,
        margin_low: float = 0.5,
        margin_high: float = 0.8,
        subsample_ratio: float = 0.1,
        faiss_nlist: int = 100,
        device: str | None = None,
    ) -> None:
        super().__init__(name=f"patchcore_{backbone}")

        if backbone not in self.SUPPORTED_BACKBONES:
            raise ValueError(
                f"Unsupported backbone: {backbone}. "
                f"Choose from {list(self.SUPPORTED_BACKBONES)}"
            )

        self.backbone_name = backbone
        self.layers = layers or ["layer2", "layer3"]
        self.n_neighbors = n_neighbors
        self.in_threshold = in_threshold
        self.margin_low = margin_low
        self.margin_high = margin_high
        self.subsample_ratio = subsample_ratio
        self.faiss_nlist = faiss_nlist
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )

        # 백본 초기화 (추론 전용)
        self._build_backbone()

        # 메모리 뱅크
        self._memory_bank: np.ndarray | None = None
        self._faiss_index: faiss.Index | None = None
        self._score_stats: dict[str, float] = {}  # min/max 정규화용

        # 전처리
        self._transform = T.Compose([
            T.ToPILImage(),
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        logger.info(
            "PatchCore initialized",
            backbone=backbone,
            layers=self.layers,
            device=str(self.device),
        )

    # ── 백본 구성 ──────────────────────────────────────────────────────────

    def _build_backbone(self) -> None:
        factory, weights = self.SUPPORTED_BACKBONES[self.backbone_name]
        model = factory(weights=weights)
        model = model.to(self.device)
        model.eval()

        # 지정 레이어에서 피처 추출을 위한 hook 등록
        self._feature_outputs: dict[str, torch.Tensor] = {}
        self._hooks: list[Any] = []

        for layer_name in self.layers:
            layer = dict(model.named_modules()).get(layer_name)
            if layer is None:
                raise ValueError(f"Layer '{layer_name}' not found in backbone")

            def _make_hook(name: str):
                def hook(_, __, output: torch.Tensor) -> None:
                    self._feature_outputs[name] = output.detach()
                return hook

            self._hooks.append(layer.register_forward_hook(_make_hook(layer_name)))

        self._backbone = model

    # ── 피처 추출 ──────────────────────────────────────────────────────────

    @torch.no_grad()
    def _extract_features(self, image: np.ndarray) -> np.ndarray:
        """이미지 → 평균풀링된 패치 피처 벡터 반환"""
        tensor = self._transform(image).unsqueeze(0).to(self.device)
        self._backbone(tensor)

        patches: list[torch.Tensor] = []
        for name in self.layers:
            feat = self._feature_outputs[name]  # [1, C, H, W]
            # 공간 평균 풀링으로 패치 피처 벡터화
            pooled = torch.nn.functional.adaptive_avg_pool2d(feat, (1, 1))
            patches.append(pooled.squeeze().cpu().float())

        # 레이어 피처 concat
        combined = torch.cat(patches, dim=0).numpy()
        return combined  # shape: [sum_of_channels]

    @torch.no_grad()
    def _extract_features_batch(self, images: list[np.ndarray]) -> np.ndarray:
        """배치 피처 추출"""
        tensors = torch.stack(
            [self._transform(img) for img in images]
        ).to(self.device)
        self._backbone(tensors)

        patches: list[torch.Tensor] = []
        for name in self.layers:
            feat = self._feature_outputs[name]  # [B, C, H, W]
            pooled = torch.nn.functional.adaptive_avg_pool2d(feat, (1, 1))
            patches.append(pooled.squeeze(-1).squeeze(-1).cpu().float())

        combined = torch.cat(patches, dim=1).numpy()
        return combined  # [B, D]

    # ── 핵심 메서드 ────────────────────────────────────────────────────────

    def fit(self, normal_images: list[np.ndarray]) -> None:
        """
        Target(정상) 이미지들로 메모리 뱅크 구축
        - 피처 추출 → 서브샘플링 → faiss 인덱스 빌드
        """
        if not normal_images:
            raise ValueError("No images provided for fitting")

        logger.info("Building PatchCore memory bank", n_images=len(normal_images))
        t0 = time.time()

        # 배치 피처 추출 (메모리 효율을 위해 청크 처리)
        chunk_size = 32
        all_features: list[np.ndarray] = []
        for i in range(0, len(normal_images), chunk_size):
            chunk = normal_images[i : i + chunk_size]
            features = self._extract_features_batch(chunk)
            all_features.append(features)

        memory = np.vstack(all_features).astype(np.float32)

        # 코어셋 서브샘플링 (메모리/속도 최적화)
        n_sub = max(1, int(len(memory) * self.subsample_ratio))
        if n_sub < len(memory):
            idx = np.random.choice(len(memory), n_sub, replace=False)
            memory = memory[idx]

        self._memory_bank = memory
        self._build_faiss_index(memory)

        # 정규화 통계 계산 (fit 데이터 기준)
        scores = self._compute_scores_batch(memory)
        self._score_stats = {
            "min": float(scores.min()),
            "max": float(scores.max()),
        }

        self._is_loaded = True
        elapsed = time.time() - t0
        logger.info(
            "PatchCore memory bank built",
            n_samples=len(memory),
            feature_dim=memory.shape[1],
            elapsed_s=round(elapsed, 2),
        )

    def _build_faiss_index(self, features: np.ndarray) -> None:
        dim = features.shape[1]
        n = len(features)

        # n이 너무 작으면 단순 Flat 인덱스 사용
        if n < self.faiss_nlist * 39:
            index = faiss.IndexFlatL2(dim)
        else:
            quantizer = faiss.IndexFlatL2(dim)
            index = faiss.IndexIVFFlat(quantizer, dim, self.faiss_nlist)
            index.train(features)

        index.add(features)
        self._faiss_index = index

    def _compute_scores_batch(self, features: np.ndarray) -> np.ndarray:
        """배치 피처에 대한 이상 점수 계산"""
        assert self._faiss_index is not None
        k = min(self.n_neighbors, self._faiss_index.ntotal)
        distances, _ = self._faiss_index.search(features, k)
        # k-NN 평균 거리를 이상 점수로 사용
        return distances.mean(axis=1)

    def _normalize_score(self, raw_score: float) -> float:
        """raw 점수를 0~1로 정규화"""
        min_s = self._score_stats.get("min", 0.0)
        max_s = self._score_stats.get("max", 1.0)
        if max_s == min_s:
            return 0.0
        return float(np.clip((raw_score - min_s) / (max_s - min_s), 0.0, 1.0))

    def predict(self, frame: np.ndarray) -> GateResult:
        if not self._is_loaded:
            raise ModelNotLoadedError("PatchCore memory bank not built. Call fit() first.")

        t0 = time.perf_counter()
        feature = self._extract_features(frame).reshape(1, -1).astype(np.float32)

        k = min(self.n_neighbors, self._faiss_index.ntotal)
        distances, _ = self._faiss_index.search(feature, k)
        raw_score = float(distances.mean())
        norm_score = self._normalize_score(raw_score)

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
            raise ModelNotLoadedError("PatchCore not fitted")

        t0 = time.perf_counter()
        features = self._extract_features_batch(frames).astype(np.float32)

        k = min(self.n_neighbors, self._faiss_index.ntotal)
        distances, _ = self._faiss_index.search(features, k)
        raw_scores = distances.mean(axis=1)

        total_ms = (time.perf_counter() - t0) * 1000
        per_ms = total_ms / len(frames)

        results = []
        for raw in raw_scores:
            norm = self._normalize_score(float(raw))
            results.append(GateResult(
                is_target=norm <= self.in_threshold,
                score=float(raw),
                normalized_score=norm,
                in_margin=self.margin_low < norm <= self.margin_high,
                model_name=self.name,
                latency_ms=round(per_ms, 2),
            ))
        return results

    def update(self, new_samples: list[np.ndarray]) -> None:
        """AL 수집 샘플을 메모리 뱅크에 추가"""
        if not self._is_loaded:
            raise ModelNotLoadedError("Must call fit() before update()")

        new_features = self._extract_features_batch(new_samples).astype(np.float32)
        self._memory_bank = np.vstack([self._memory_bank, new_features])
        self._build_faiss_index(self._memory_bank)

        logger.info(
            "PatchCore memory bank updated",
            added=len(new_samples),
            total=len(self._memory_bank),
        )

    # ── 저장 / 로드 ────────────────────────────────────────────────────────

    def save(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)

        try:
            # faiss 인덱스 저장
            faiss.write_index(
                self._faiss_index, str(path / "faiss.index")
            )
            # 메타데이터 저장
            meta = {
                "memory_bank": self._memory_bank,
                "score_stats": self._score_stats,
                "config": {
                    "backbone": self.backbone_name,
                    "layers": self.layers,
                    "n_neighbors": self.n_neighbors,
                    "in_threshold": self.in_threshold,
                    "margin_low": self.margin_low,
                    "margin_high": self.margin_high,
                },
            }
            with open(path / "meta.pkl", "wb") as f:
                pickle.dump(meta, f)

            logger.info("PatchCore saved", path=str(path))
        except Exception as e:
            raise ModelSaveError(f"Failed to save PatchCore", detail=str(e)) from e

    def load(self, path: Path) -> None:
        path = Path(path)
        try:
            self._faiss_index = faiss.read_index(str(path / "faiss.index"))
            with open(path / "meta.pkl", "rb") as f:
                meta = pickle.load(f)
            self._memory_bank = meta["memory_bank"]
            self._score_stats = meta["score_stats"]
            self._is_loaded = True
            logger.info("PatchCore loaded", path=str(path))
        except Exception as e:
            raise ModelLoadError(f"Failed to load PatchCore", detail=str(e)) from e
