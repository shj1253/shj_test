"""
메트릭 API — 실시간 지표 조회
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/summary")
async def metrics_summary():
    """현재 슬라이딩 윈도우 메트릭 스냅샷"""
    from backend.main import get_metrics_tracker
    tracker = get_metrics_tracker()
    if tracker is None:
        raise HTTPException(status_code=503, detail="Metrics tracker not initialized")
    return tracker.current_metrics.to_dict()


@router.get("/history")
async def metrics_history(n: int = Query(50, ge=1, le=500)):
    """최근 n개 추론 결과 이력"""
    from backend.main import get_metrics_tracker
    tracker = get_metrics_tracker()
    if tracker is None:
        raise HTTPException(status_code=503, detail="Metrics tracker not initialized")
    return {"history": tracker.get_history(n), "count": n}


@router.get("/session")
async def session_info():
    """세션 정보"""
    from backend.main import get_metrics_tracker
    tracker = get_metrics_tracker()
    if tracker is None:
        raise HTTPException(status_code=503, detail="Metrics tracker not initialized")
    return tracker.session_info


@router.post("/reset")
async def reset_metrics():
    """메트릭 초기화"""
    from backend.main import get_metrics_tracker
    tracker = get_metrics_tracker()
    if tracker:
        tracker.reset()
    return {"status": "reset"}


@router.get("/pipeline")
async def pipeline_status():
    """파이프라인 상태 조회"""
    from backend.main import get_pipeline
    pipeline = get_pipeline()
    if pipeline is None:
        return {"initialized": False}
    return {"initialized": True, **pipeline.get_status()}
