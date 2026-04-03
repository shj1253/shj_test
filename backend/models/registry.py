"""
모델 레지스트리 — 런타임 모델 등록 / 조회 / 교체
"""
from __future__ import annotations

from backend.config import settings
from backend.exceptions import UnsupportedModelError
from backend.logging_config import get_logger
from backend.models.base import BaseClassifierModel, BaseGateModel
from backend.models.classifier.resnet_classifier import ResNetClassifier
from backend.models.gate.efficientnet_gate import EfficientNetGate
from backend.models.gate.patchcore import PatchCoreModel

logger = get_logger(__name__)


class ModelRegistry:
    """
    Gate / Classifier 모델 인스턴스를 관리하는 싱글턴 레지스트리
    - 런타임 중 swap_gate() / swap_classifier()로 교체 가능
    - A/B 비교 시 두 Gate 모델을 동시에 보유할 수 있음
    """

    def __init__(self) -> None:
        self._gates: dict[str, BaseGateModel] = {}
        self._classifiers: dict[str, BaseClassifierModel] = {}
        self._active_gate: str | None = None
        self._active_classifier: str | None = None

    # ── 팩토리 ────────────────────────────────────────────────────────────

    def create_gate(self, model_type: str, **kwargs) -> BaseGateModel:
        """Gate 모델 인스턴스 생성"""
        if model_type == "patchcore":
            gate = PatchCoreModel(
                backbone=kwargs.get("backbone", settings.gate_backbone),
                in_threshold=settings.gate_in_threshold,
                margin_low=settings.gate_margin_low,
                margin_high=settings.gate_margin_high,
            )
        elif model_type == "efficientnet":
            gate = EfficientNetGate(
                variant=kwargs.get("variant", settings.efficientnet_variant),
                in_threshold=settings.gate_in_threshold,
                margin_low=settings.gate_margin_low,
                margin_high=settings.gate_margin_high,
            )
        else:
            raise UnsupportedModelError(f"Unknown gate model type: {model_type}")

        return gate

    def create_classifier(self, backbone: str = "resnet50", **kwargs) -> BaseClassifierModel:
        """Classifier 모델 인스턴스 생성"""
        return ResNetClassifier(
            backbone=backbone,
            num_classes=settings.num_targets,
            uncertainty_threshold=settings.uncertainty_threshold,
            margin_threshold=settings.margin_threshold,
            **kwargs,
        )

    # ── 등록 / 활성화 ─────────────────────────────────────────────────────

    def register_gate(self, key: str, model: BaseGateModel, activate: bool = True) -> None:
        self._gates[key] = model
        if activate:
            self._active_gate = key
        logger.info("Gate model registered", key=key, active=activate)

    def register_classifier(
        self, key: str, model: BaseClassifierModel, activate: bool = True
    ) -> None:
        self._classifiers[key] = model
        if activate:
            self._active_classifier = key
        logger.info("Classifier model registered", key=key, active=activate)

    # ── 조회 ─────────────────────────────────────────────────────────────

    @property
    def active_gate(self) -> BaseGateModel:
        if self._active_gate is None or self._active_gate not in self._gates:
            raise UnsupportedModelError("No active gate model. Register one first.")
        return self._gates[self._active_gate]

    @property
    def active_classifier(self) -> BaseClassifierModel:
        if self._active_classifier is None or self._active_classifier not in self._classifiers:
            raise UnsupportedModelError("No active classifier. Register one first.")
        return self._classifiers[self._active_classifier]

    def get_gate(self, key: str) -> BaseGateModel:
        if key not in self._gates:
            raise UnsupportedModelError(f"Gate model '{key}' not registered")
        return self._gates[key]

    def get_classifier(self, key: str) -> BaseClassifierModel:
        if key not in self._classifiers:
            raise UnsupportedModelError(f"Classifier '{key}' not registered")
        return self._classifiers[key]

    def list_gates(self) -> list[dict]:
        return [
            {
                "key": k,
                "name": v.name,
                "is_active": k == self._active_gate,
                "is_loaded": v.is_loaded,
            }
            for k, v in self._gates.items()
        ]

    def list_classifiers(self) -> list[dict]:
        return [
            {
                "key": k,
                "name": v.name,
                "is_active": k == self._active_classifier,
                "is_loaded": v.is_loaded,
            }
            for k, v in self._classifiers.items()
        ]

    # ── 런타임 교체 ───────────────────────────────────────────────────────

    def swap_gate(self, key: str) -> None:
        if key not in self._gates:
            raise UnsupportedModelError(f"Gate model '{key}' not registered")
        prev = self._active_gate
        self._active_gate = key
        logger.info("Gate model swapped", prev=prev, current=key)

    def swap_classifier(self, key: str) -> None:
        if key not in self._classifiers:
            raise UnsupportedModelError(f"Classifier '{key}' not registered")
        prev = self._active_classifier
        self._active_classifier = key
        logger.info("Classifier swapped", prev=prev, current=key)


# 싱글턴 인스턴스
registry = ModelRegistry()
