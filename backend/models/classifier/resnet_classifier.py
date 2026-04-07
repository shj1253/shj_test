"""
ResNet 기반 T1/T2/T3/T4 분류기
- ResNet 18 / 34 / 50 선택 가능
- ImageNet 사전학습 가중치 + Fine-tuning
- Uncertainty / Margin 계산을 위한 softmax 확률 출력
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Literal

import numpy as np
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as T
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader

from backend.exceptions import ModelLoadError, ModelNotLoadedError, ModelSaveError
from backend.logging_config import get_logger
from backend.models.base import BaseClassifierModel, ClassifyResult

logger = get_logger(__name__)

BackboneType = Literal["resnet18", "resnet34", "resnet50"]


class ResNetClassifier(BaseClassifierModel):
    """
    ResNet 기반 4클래스 분류기

    동작 원리:
    1. ImageNet 사전학습 ResNet에서 FC 헤드를 4클래스로 교체
    2. 증강 데이터로 fine-tuning
    3. 추론 시 softmax 확률 → confidence, margin 계산
    4. Uncertainty / Margin 기반으로 AL 후보 판별
    """

    BACKBONE_FACTORIES = {
        "resnet18": (models.resnet18, models.ResNet18_Weights.IMAGENET1K_V1),
        "resnet34": (models.resnet34, models.ResNet34_Weights.IMAGENET1K_V1),
        "resnet50": (models.resnet50, models.ResNet50_Weights.IMAGENET1K_V2),
    }

    def __init__(
        self,
        backbone: BackboneType = "resnet50",
        num_classes: int = 4,
        uncertainty_threshold: float = 0.7,
        margin_threshold: float = 0.2,
        device: str | None = None,
        dropout_rate: float = 0.3,
    ) -> None:
        super().__init__(name=f"resnet_{backbone}_classifier", num_classes=num_classes)

        if backbone not in self.BACKBONE_FACTORIES:
            raise ValueError(f"Unsupported backbone: {backbone}")

        self.backbone_name = backbone
        self.uncertainty_threshold = uncertainty_threshold
        self.margin_threshold = margin_threshold
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self.dropout_rate = dropout_rate

        self._model = self._build_model()
        self._transform = self._build_transform()

        logger.info(
            "ResNetClassifier initialized",
            backbone=backbone,
            num_classes=num_classes,
            device=str(self.device),
        )

    # ── 모델 / 전처리 빌드 ────────────────────────────────────────────────

    def _build_model(self) -> nn.Module:
        factory, weights = self.BACKBONE_FACTORIES[self.backbone_name]
        model = factory(weights=weights)

        # FC 헤드 교체
        in_features = model.fc.in_features
        model.fc = nn.Sequential(
            nn.Dropout(p=self.dropout_rate),
            nn.Linear(in_features, self.num_classes),
        )
        model = model.to(self.device)
        model.eval()  # 추론 모드 기본 — fine_tune()에서 train()으로 전환
        return model

    def _build_transform(self) -> T.Compose:
        return T.Compose([
            T.ToPILImage(),
            T.Resize((256, 256)),
            T.CenterCrop(224),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def _build_train_transform(self) -> T.Compose:
        return T.Compose([
            T.ToPILImage(),
            T.RandomResizedCrop(224, scale=(0.7, 1.0)),
            T.RandomHorizontalFlip(),
            T.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    # ── 피처 추출 ──────────────────────────────────────────────────────────

    @torch.no_grad()
    def _forward(self, frame: np.ndarray) -> torch.Tensor:
        tensor = self._transform(frame).unsqueeze(0).to(self.device)
        return self._model(tensor)  # logits [1, num_classes]

    @torch.no_grad()
    def _forward_batch(self, frames: list[np.ndarray]) -> torch.Tensor:
        tensors = torch.stack([
            self._transform(f) for f in frames
        ]).to(self.device)
        return self._model(tensors)  # [B, num_classes]

    # ── 핵심 메서드 ────────────────────────────────────────────────────────

    def predict(self, frame: np.ndarray) -> ClassifyResult:
        if not self._is_loaded:
            raise ModelNotLoadedError("ResNetClassifier not trained/loaded")

        t0 = time.perf_counter()

        logits = self._forward(frame)
        probs = torch.softmax(logits, dim=-1).squeeze().cpu().numpy()

        return self._make_result(probs, (time.perf_counter() - t0) * 1000)

    def predict_batch(self, frames: list[np.ndarray]) -> list[ClassifyResult]:
        if not self._is_loaded:
            raise ModelNotLoadedError("ResNetClassifier not trained/loaded")

        t0 = time.perf_counter()

        logits = self._forward_batch(frames)
        probs_batch = torch.softmax(logits, dim=-1).cpu().numpy()

        total_ms = (time.perf_counter() - t0) * 1000
        per_ms = total_ms / len(frames)

        return [self._make_result(probs, per_ms) for probs in probs_batch]

    def predict_proba(self, frame: np.ndarray) -> np.ndarray:
        if not self._is_loaded:
            raise ModelNotLoadedError("ResNetClassifier not trained/loaded")
        logits = self._forward(frame)
        return torch.softmax(logits, dim=-1).squeeze().cpu().numpy()

    def _make_result(self, probs: np.ndarray, latency_ms: float) -> ClassifyResult:
        sorted_idx = np.argsort(probs)[::-1]
        top1_idx = int(sorted_idx[0])
        top1_conf = float(probs[top1_idx])
        top2_conf = float(probs[sorted_idx[1]]) if len(sorted_idx) > 1 else 0.0
        margin = top1_conf - top2_conf

        return ClassifyResult(
            target_id=top1_idx + 1,           # 1-indexed (T1~T4)
            confidence=top1_conf,
            probabilities=probs.tolist(),
            is_uncertain=top1_conf < self.uncertainty_threshold,
            margin=margin,
            model_name=self.name,
            latency_ms=round(latency_ms, 2),
        )

    # ── 학습 ──────────────────────────────────────────────────────────────

    def fine_tune(
        self,
        images: list[np.ndarray],
        labels: list[int],
        epochs: int = 10,
        lr: float = 1e-4,
        batch_size: int = 16,
        freeze_backbone: bool = False,
    ) -> dict[str, float]:
        """
        AL 레이블 데이터로 fine-tuning

        Args:
            images: 이미지 목록 (numpy BGR/RGB)
            labels: 0-indexed 레이블 (0=T1, 1=T2, 2=T3, 3=T4)
            epochs: 학습 에폭
            lr: 학습률
            batch_size: 배치 크기
            freeze_backbone: True면 헤드만 학습 (데이터 부족 시)

        Returns:
            최종 에폭의 loss, accuracy
        """
        logger.info(
            "Fine-tuning ResNet",
            n_samples=len(images),
            epochs=epochs,
            backbone=self.backbone_name,
        )

        train_transform = self._build_train_transform()

        # 메모리 효율 Dataset — 배치 단위로만 변환 (전체 텐서 사전 변환 금지)
        # 기존 방식(torch.stack 전체)은 2000장 기준 ~1.2GB RAM 소모 → OOM
        class _LazyDataset(torch.utils.data.Dataset):
            def __init__(self, imgs: list, lbls: list, tfm: T.Compose) -> None:
                self._imgs = imgs
                self._lbls = lbls
                self._tfm = tfm

            def __len__(self) -> int:
                return len(self._imgs)

            def __getitem__(self, idx: int):
                return self._tfm(self._imgs[idx]), self._lbls[idx]

        dataset = _LazyDataset(images, labels, train_transform)
        loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=0)

        if freeze_backbone:
            for name, param in self._model.named_parameters():
                param.requires_grad = "fc" in name
        else:
            for param in self._model.parameters():
                param.requires_grad = True

        optimizer = AdamW(
            filter(lambda p: p.requires_grad, self._model.parameters()),
            lr=lr, weight_decay=1e-4
        )
        scheduler = CosineAnnealingLR(optimizer, T_max=epochs)
        criterion = nn.CrossEntropyLoss()

        self._model.train()
        history: list[dict] = []

        for epoch in range(epochs):
            total_loss, correct, total = 0.0, 0, 0
            for batch_imgs, batch_labels in loader:
                batch_imgs = batch_imgs.to(self.device)
                batch_labels = batch_labels.to(self.device)

                optimizer.zero_grad()
                logits = self._model(batch_imgs)
                loss = criterion(logits, batch_labels)
                loss.backward()
                optimizer.step()

                total_loss += loss.item() * len(batch_labels)
                preds = logits.argmax(dim=-1)
                correct += (preds == batch_labels).sum().item()
                total += len(batch_labels)

            scheduler.step()
            epoch_loss = total_loss / total
            epoch_acc = correct / total
            history.append({"loss": epoch_loss, "accuracy": epoch_acc})

            logger.info(
                "Fine-tune epoch",
                epoch=epoch + 1,
                loss=round(epoch_loss, 4),
                accuracy=round(epoch_acc, 4),
            )

        self._model.eval()
        self._is_loaded = True

        return history[-1]

    # ── 저장 / 로드 ────────────────────────────────────────────────────────

    def save(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        try:
            torch.save(
                {
                    "model_state_dict": self._model.state_dict(),
                    "config": {
                        "backbone": self.backbone_name,
                        "num_classes": self.num_classes,
                        "uncertainty_threshold": self.uncertainty_threshold,
                        "margin_threshold": self.margin_threshold,
                        "dropout_rate": self.dropout_rate,
                    },
                },
                path / "resnet_classifier.pt",
            )
            logger.info("ResNetClassifier saved", path=str(path))
        except Exception as e:
            raise ModelSaveError("Failed to save ResNetClassifier", detail=str(e)) from e

    def load(self, path: Path) -> None:
        path = Path(path)
        try:
            ckpt = torch.load(
                path / "resnet_classifier.pt",
                map_location=self.device,
                weights_only=False,
            )
            self._model.load_state_dict(ckpt["model_state_dict"])
            self._model.eval()
            self._is_loaded = True
            logger.info("ResNetClassifier loaded", path=str(path))
        except Exception as e:
            raise ModelLoadError("Failed to load ResNetClassifier", detail=str(e)) from e
