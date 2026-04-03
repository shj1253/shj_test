"""
전체 파이프라인 학습 스크립트
Target 이미지 4개 → 증강 → Gate 학습 + Classifier 학습 → 저장

사용법:
    python training/train_pipeline.py \
        --target-dir artifacts/data/raw \
        --gate-type patchcore \
        --classifier-backbone resnet50 \
        --n-aug 500

    # 두 Gate 모두 학습 (비교용)
    python training/train_pipeline.py \
        --target-dir artifacts/data/raw \
        --gate-type both \
        --n-aug 500
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

# 프로젝트 루트를 sys.path에 추가
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import settings
from backend.data.augmentation import FieldAugmentor
from backend.logging_config import get_logger, setup_logging
from backend.models.classifier.resnet_classifier import ResNetClassifier
from backend.models.gate.efficientnet_gate import EfficientNetGate
from backend.models.gate.patchcore import PatchCoreModel

setup_logging("INFO")
logger = get_logger("train_pipeline")


def load_target_images(target_dir: Path) -> dict[int, np.ndarray]:
    """
    Target 이미지 디렉터리 로드

    디렉터리 구조:
        target_dir/
            T1/ (또는 1/ 또는 target1.jpg 등)
            T2/
            T3/
            T4/

    또는 단일 파일:
        target_dir/
            T1.jpg
            T2.jpg
            T3.jpg
            T4.jpg
    """
    target_images: dict[int, np.ndarray] = {}

    # 단일 파일 패턴 시도
    for tid in range(1, 5):
        for pattern in [
            f"T{tid}.jpg", f"T{tid}.png", f"T{tid}.jpeg",
            f"target{tid}.jpg", f"target{tid}.png",
            f"{tid}.jpg", f"{tid}.png",
        ]:
            fpath = target_dir / pattern
            if fpath.exists():
                img = cv2.imread(str(fpath))
                if img is not None:
                    target_images[tid] = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                    logger.info(f"Loaded T{tid} from {fpath}")
                break

        # 서브디렉터리 패턴 시도
        if tid not in target_images:
            for dname in [f"T{tid}", f"t{tid}", f"target{tid}", str(tid)]:
                dpath = target_dir / dname
                if dpath.is_dir():
                    files = sorted(dpath.glob("*.jpg")) + sorted(dpath.glob("*.png"))
                    if files:
                        img = cv2.imread(str(files[0]))
                        if img is not None:
                            target_images[tid] = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                            logger.info(f"Loaded T{tid} from {dpath}/{files[0].name}")
                        break

    missing = [i for i in range(1, 5) if i not in target_images]
    if missing:
        logger.warning(f"Missing target images: {[f'T{i}' for i in missing]}")
    else:
        logger.info("All 4 target images loaded")

    return target_images


def train_patchcore(
    target_images: dict[int, np.ndarray],
    augmented_images: list[np.ndarray],
    save_dir: Path,
    backbone: str = "wide_resnet50_2",
) -> PatchCoreModel:
    """PatchCore Gate 학습"""
    logger.info("Training PatchCore Gate", backbone=backbone, n_images=len(augmented_images))
    t0 = time.time()

    model = PatchCoreModel(
        backbone=backbone,
        in_threshold=settings.gate_in_threshold,
        margin_low=settings.gate_margin_low,
        margin_high=settings.gate_margin_high,
    )
    model.fit(augmented_images)
    model.save(save_dir / "patchcore")

    elapsed = time.time() - t0
    logger.info(f"PatchCore trained in {elapsed:.1f}s")
    return model


def train_efficientnet_gate(
    target_images: dict[int, np.ndarray],
    augmented_images: list[np.ndarray],
    augmented_labels: list[int],
    save_dir: Path,
    variant: str = "b3",
) -> EfficientNetGate:
    """EfficientNet Gate 학습"""
    logger.info(f"Training EfficientNet-{variant} Gate", n_images=len(augmented_images))
    t0 = time.time()

    model = EfficientNetGate(
        variant=variant,
        in_threshold=settings.gate_in_threshold,
        margin_low=settings.gate_margin_low,
        margin_high=settings.gate_margin_high,
    )
    model.fit(augmented_images, labels=augmented_labels)
    model.save(save_dir / f"efficientnet_{variant}")

    elapsed = time.time() - t0
    logger.info(f"EfficientNet Gate trained in {elapsed:.1f}s")
    return model


def train_classifier(
    augmented_images: list[np.ndarray],
    augmented_labels: list[int],
    save_dir: Path,
    backbone: str = "resnet50",
    epochs: int = 20,
) -> ResNetClassifier:
    """ResNet Classifier 학습"""
    logger.info(
        "Training ResNet Classifier",
        backbone=backbone,
        n_images=len(augmented_images),
        epochs=epochs,
    )
    t0 = time.time()

    model = ResNetClassifier(
        backbone=backbone,
        num_classes=4,
        uncertainty_threshold=settings.uncertainty_threshold,
        margin_threshold=settings.margin_threshold,
    )
    metrics = model.fine_tune(
        images=augmented_images,
        labels=augmented_labels,
        epochs=epochs,
        lr=1e-4,
        batch_size=32,
    )
    model.save(save_dir / f"resnet_{backbone}")

    elapsed = time.time() - t0
    logger.info(
        f"Classifier trained in {elapsed:.1f}s",
        final_loss=metrics["loss"],
        final_accuracy=metrics["accuracy"],
    )
    return model, metrics


def run_quick_eval(
    gate_model,
    classifier_model,
    test_images: list[np.ndarray],
    test_labels: list[int],
) -> dict:
    """학습 후 간단한 평가"""
    from sklearn.metrics import accuracy_score, f1_score

    correct_gate = 0
    y_true, y_pred = [], []

    for img, label in zip(test_images, test_labels):
        gate_result = gate_model.predict(img)
        if gate_result.is_target:
            correct_gate += 1
            clf_result = classifier_model.predict(img)
            y_true.append(label)
            y_pred.append(clf_result.target_id - 1)

    gate_tpr = correct_gate / len(test_images)
    acc = accuracy_score(y_true, y_pred) if y_true else 0.0
    f1 = f1_score(y_true, y_pred, average="macro", zero_division=0) if y_true else 0.0

    return {
        "gate_tpr": round(gate_tpr, 4),
        "classify_accuracy": round(acc, 4),
        "classify_f1": round(f1, 4),
        "n_eval": len(test_images),
    }


def main():
    parser = argparse.ArgumentParser(description="Canon Project Pipeline Training")
    parser.add_argument("--target-dir", type=str, default="artifacts/data/raw")
    parser.add_argument("--gate-type", choices=["patchcore", "efficientnet", "both"],
                        default="both")
    parser.add_argument("--gate-backbone", type=str, default="wide_resnet50_2")
    parser.add_argument("--efficientnet-variant", type=str, default="b3")
    parser.add_argument("--classifier-backbone",
                        choices=["resnet18", "resnet34", "resnet50"], default="resnet50")
    parser.add_argument("--n-aug", type=int, default=500,
                        help="Target 1개당 증강 이미지 수")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--save-dir", type=str, default="artifacts/models")
    args = parser.parse_args()

    target_dir = Path(args.target_dir)
    save_dir = Path(args.save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    # 1. Target 이미지 로드
    logger.info("=" * 60)
    logger.info("STEP 1: Loading target images")
    target_images = load_target_images(target_dir)

    if not target_images:
        logger.error(f"No target images found in {target_dir}")
        logger.info("Please place target images as:")
        logger.info("  artifacts/data/raw/T1.jpg, T2.jpg, T3.jpg, T4.jpg")
        return

    # 2. 증강 데이터 생성
    logger.info("=" * 60)
    logger.info(f"STEP 2: Generating augmented data ({args.n_aug} per target)")
    augmentor = FieldAugmentor()
    all_images, all_labels = augmentor.generate_all_targets(
        target_images, n_per_target=args.n_aug
    )
    logger.info(f"Total augmented images: {len(all_images)}")

    # 학습/검증 분할 (8:2)
    n = len(all_images)
    n_train = int(n * 0.8)
    indices = np.random.permutation(n)
    train_idx = indices[:n_train]
    val_idx = indices[n_train:]

    train_images = [all_images[i] for i in train_idx]
    train_labels = [all_labels[i] for i in train_idx]
    val_images = [all_images[i] for i in val_idx]
    val_labels = [all_labels[i] for i in val_idx]

    results = {}

    # 3. Classifier 학습 (공통)
    logger.info("=" * 60)
    logger.info("STEP 3: Training ResNet Classifier")
    classifier, clf_metrics = train_classifier(
        train_images, train_labels, save_dir,
        backbone=args.classifier_backbone,
        epochs=args.epochs,
    )
    results["classifier"] = {
        "backbone": args.classifier_backbone,
        **clf_metrics,
    }

    # 4. Gate 학습
    logger.info("=" * 60)
    if args.gate_type in ("patchcore", "both"):
        logger.info("STEP 4a: Training PatchCore Gate")
        patchcore_gate = train_patchcore(
            target_images, train_images, save_dir,
            backbone=args.gate_backbone,
        )
        eval_a = run_quick_eval(patchcore_gate, classifier, val_images, val_labels)
        logger.info("PatchCore eval", **eval_a)
        results["patchcore"] = eval_a

    if args.gate_type in ("efficientnet", "both"):
        logger.info("STEP 4b: Training EfficientNet Gate")
        eff_gate = train_efficientnet_gate(
            target_images, train_images, train_labels, save_dir,
            variant=args.efficientnet_variant,
        )
        eval_b = run_quick_eval(eff_gate, classifier, val_images, val_labels)
        logger.info("EfficientNet eval", **eval_b)
        results["efficientnet"] = eval_b

    # 5. 결과 저장
    report_path = save_dir / "training_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    logger.info("=" * 60)
    logger.info("Training complete!")
    logger.info(f"Models saved to: {save_dir}")
    logger.info(f"Report saved to: {report_path}")

    if "patchcore" in results and "efficientnet" in results:
        a = results["patchcore"]
        b = results["efficientnet"]
        logger.info("\n=== A/B COMPARISON ===")
        logger.info(f"PatchCore   F1: {a.get('classify_f1', 0):.4f}  Gate TPR: {a.get('gate_tpr', 0):.4f}")
        logger.info(f"EfficientNet F1: {b.get('classify_f1', 0):.4f}  Gate TPR: {b.get('gate_tpr', 0):.4f}")

    return results


if __name__ == "__main__":
    main()
