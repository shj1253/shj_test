"""
카메라 스트리밍 API — 실시간 모드 제어
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/camera", tags=["camera"])


class CameraStartRequest(BaseModel):
    device_id: int = 0
    fps: int = 30
    width: int = 1280
    height: int = 720


class FileSourceRequest(BaseModel):
    path: str
    loop: bool = False
    frame_interval_ms: int = 33


@router.post("/start")
async def start_camera(req: CameraStartRequest):
    """실시간 카메라 모드 시작"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager()
    if mgr is None:
        raise HTTPException(status_code=503, detail="Stream manager not initialized")
    try:
        await mgr.start_camera(
            device_id=req.device_id,
            fps=req.fps,
            width=req.width,
            height=req.height,
        )
        return {"status": "started", "mode": "camera", "device_id": req.device_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_camera():
    """카메라/스트리밍 중지"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager()
    if mgr is None:
        raise HTTPException(status_code=503, detail="Stream manager not initialized")
    await mgr.stop()
    return {"status": "stopped"}


@router.post("/file")
async def start_file_source(req: FileSourceRequest):
    """파일 소스 기반 테스트 모드 시작"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager()
    if mgr is None:
        raise HTTPException(status_code=503, detail="Stream manager not initialized")
    try:
        await mgr.start_file(
            path=req.path,
            loop=req.loop,
            frame_interval_ms=req.frame_interval_ms,
        )
        return {"status": "started", "mode": "file", "path": req.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def camera_status():
    """현재 스트리밍 상태"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager()
    if mgr is None:
        return {"running": False}
    return mgr.status()
