"""
Active Learning API — 큐 조회 / 레이블 제출 / Undo / 재학습
"""
from __future__ import annotations

import base64

import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/al", tags=["active_learning"])


class LabelRequest(BaseModel):
    sample_id: str
    label: int = Field(..., ge=0, description="0=T1, 1=T2, ... (num_targets-1)")


class TrainRequest(BaseModel):
    epochs: int = Field(10, ge=1, le=100)
    lr: float = Field(1e-4, gt=0)
    batch_size: int = Field(16, ge=4, le=128)


@router.get("/queue")
async def get_queue():
    """미라벨 AL 큐 조회 (우선순위 내림차순)"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL engine not initialized")

    unlabeled = engine.queue.get_unlabeled()
    return {
        "stats": engine.stats,
        "samples": [
            {
                "sample_id": s.sample_id,
                "queue_type": s.queue_type,
                "gate_score": round(s.gate_score, 4),
                "uncertainty_score": round(s.uncertainty_score, 4),
                "margin_score": round(s.margin_score, 4),
                "priority_score": round(s.priority_score, 4),
                "added_at": s.added_at.isoformat(),
                "classify_probs": s.classify_probs,
            }
            for s in unlabeled[:50]  # 최대 50개 반환
        ],
    }


@router.post("/label")
async def submit_label(req: LabelRequest):
    """샘플 레이블 제출"""
    from backend.main import get_al_engine
    from backend.config import settings
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL 엔진이 초기화되지 않았습니다. 서버를 재시작하세요.")

    if req.label >= settings.num_targets:
        raise HTTPException(
            status_code=422,
            detail=f"레이블 값 {req.label}이 범위를 초과합니다. 유효 범위: 0~{settings.num_targets - 1} (T1~T{settings.num_targets})",
        )

    try:
        sample = engine.queue.label(req.sample_id, req.label)
        return {
            "status": "labeled",
            "sample_id": req.sample_id,
            "label": req.label,
            "label_name": f"T{req.label + 1}",
            "labeled_at": sample.labeled_at.isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/label/{sample_id}")
async def undo_label(sample_id: str):
    """레이블 취소 (Undo)"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL engine not initialized")

    try:
        sample = engine.queue.undo_label(sample_id)
        return {
            "status": "undone",
            "sample_id": sample_id,
            "returned_to_queue": True,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/label")
async def undo_last_label():
    """마지막 레이블 취소"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL engine not initialized")

    try:
        sample = engine.queue.undo_label(None)
        return {
            "status": "undone",
            "sample_id": sample.sample_id,
            "returned_to_queue": True,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/queue/{sample_id}")
async def skip_sample(sample_id: str):
    """샘플을 큐에서 제거 (스킵 — 레이블 없이 폐기)"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL 엔진이 초기화되지 않았습니다.")

    try:
        engine.queue.remove(sample_id)
        return {"status": "skipped", "sample_id": sample_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/train")
async def trigger_training(req: TrainRequest):
    """레이블된 샘플로 재학습 트리거"""
    from backend.main import get_al_engine, get_pipeline

    engine = get_al_engine()
    pipeline = get_pipeline()

    if engine is None or pipeline is None:
        raise HTTPException(status_code=503, detail="Engine not initialized")

    labeled = engine.queue.get_labeled()
    if not labeled:
        raise HTTPException(status_code=400, detail="No labeled samples available")

    images = [s.frame for s in labeled]
    labels = [s.label for s in labeled]

    try:
        metrics = pipeline.classifier.fine_tune(
            images=images,
            labels=labels,
            epochs=req.epochs,
            lr=req.lr,
            batch_size=req.batch_size,
        )
        engine.queue.clear_labeled()

        return {
            "status": "trained",
            "n_samples": len(labeled),
            "final_metrics": metrics,
        }
    except Exception as e:
        logger.error("Training failed", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/samples/{sample_id}/image")
async def get_sample_image(sample_id: str):
    """AL 샘플 프레임 이미지 반환 (base64 JPEG)"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL engine not initialized")
    try:
        sample = engine.queue.get_sample(sample_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    if sample.frame is None:
        raise HTTPException(status_code=404, detail="프레임 데이터가 없습니다 (evicted)")

    bgr = cv2.cvtColor(sample.frame, cv2.COLOR_RGB2BGR)
    _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return {"image": f"data:image/jpeg;base64,{b64}"}


@router.get("/stats")
async def al_stats():
    """AL 엔진 통계"""
    from backend.main import get_al_engine
    engine = get_al_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="AL engine not initialized")
    return engine.stats
