"""
카메라 스트리밍 API — 실시간 모드 제어 (다중 카메라 지원)
"""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File as FastAPIFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

_TEST_VIDEO_DIR = Path("artifacts/test_videos")

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


# ── 카메라 목록 ────────────────────────────────────────────────────────────

@router.get("/list")
async def list_cameras():
    """활성 카메라 목록"""
    from backend.main import list_stream_managers
    managers = list_stream_managers()
    return {
        "cameras": [
            {"camera_id": cid, **mgr.status()}
            for cid, mgr in managers.items()
        ]
    }


# ── 카메라별 제어 ──────────────────────────────────────────────────────────

@router.post("/{camera_id}/start")
async def start_camera(camera_id: str, req: CameraStartRequest):
    """카메라 시작"""
    from backend.main import get_or_create_stream_manager
    mgr = await get_or_create_stream_manager(camera_id)
    try:
        await mgr.start_camera(
            device_id=req.device_id,
            fps=req.fps,
            width=req.width,
            height=req.height,
        )
        return {"status": "started", "camera_id": camera_id, "mode": "camera", "device_id": req.device_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{camera_id}/stop")
async def stop_camera(camera_id: str):
    """카메라 중지"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager(camera_id)
    if mgr is None:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
    await mgr.stop()
    return {"status": "stopped", "camera_id": camera_id}


@router.post("/{camera_id}/file")
async def start_file_source(camera_id: str, req: FileSourceRequest):
    """파일 소스 기반 테스트 모드"""
    from backend.main import get_or_create_stream_manager
    mgr = await get_or_create_stream_manager(camera_id)
    try:
        await mgr.start_file(
            path=req.path,
            loop=req.loop,
            frame_interval_ms=req.frame_interval_ms,
        )
        return {"status": "started", "camera_id": camera_id, "mode": "file", "path": req.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{camera_id}/upload-and-start")
async def upload_and_start(
    camera_id: str,
    file: UploadFile = FastAPIFile(...),
    loop: bool = True,
):
    """테스트용 영상/이미지 업로드 후 즉시 스트림 시작"""
    _TEST_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "upload").name
    dest = _TEST_VIDEO_DIR / safe_name
    try:
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {e}")

    from backend.main import get_or_create_stream_manager
    mgr = await get_or_create_stream_manager(camera_id)
    try:
        await mgr.start_file(path=str(dest), loop=loop, frame_interval_ms=33)
        return {"status": "started", "camera_id": camera_id, "mode": "file", "path": str(dest)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{camera_id}/status")
async def camera_status(camera_id: str):
    """카메라 상태"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager(camera_id)
    if mgr is None:
        return {"camera_id": camera_id, "running": False, "mode": "idle"}
    return mgr.status()


@router.get("/{camera_id}/feed")
async def camera_feed(camera_id: str):
    """MJPEG 스트리밍"""
    from backend.main import get_stream_manager

    async def generate():
        while True:
            mgr = get_stream_manager(camera_id)
            if mgr and mgr.last_jpeg:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + mgr.last_jpeg
                    + b"\r\n"
                )
            await asyncio.sleep(1 / 15)  # 15fps

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/{camera_id}/snapshot")
async def camera_snapshot(camera_id: str):
    """현재 프레임 단일 JPEG 반환 (폴링용)"""
    from fastapi.responses import Response
    from backend.main import get_stream_manager
    mgr = get_stream_manager(camera_id)
    if not mgr or not mgr.last_jpeg:
        raise HTTPException(status_code=503, detail="No frame available")
    return Response(
        content=mgr.last_jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.post("/{camera_id}/rtsp")
async def start_rtsp(camera_id: str, req: FileSourceRequest):
    """RTSP / IP 카메라 URL로 스트림 시작"""
    from backend.main import get_or_create_stream_manager
    from backend.stream_manager import StreamManager
    mgr = await get_or_create_stream_manager(camera_id)
    try:
        await mgr.start_rtsp(url=req.path)
        return {"status": "started", "camera_id": camera_id, "mode": "rtsp", "url": req.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{camera_id}")
async def remove_camera(camera_id: str):
    """카메라 제거 (StreamManager 종료)"""
    from backend.main import remove_stream_manager
    await remove_stream_manager(camera_id)
    return {"status": "removed", "camera_id": camera_id}


# ── 하위 호환 (카메라 0) ──────────────────────────────────────────────────

@router.post("/start")
async def start_camera_default(req: CameraStartRequest):
    from backend.main import get_or_create_stream_manager
    mgr = await get_or_create_stream_manager("0")
    try:
        await mgr.start_camera(device_id=req.device_id, fps=req.fps, width=req.width, height=req.height)
        return {"status": "started", "camera_id": "0", "mode": "camera"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_camera_default():
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr:
        await mgr.stop()
    return {"status": "stopped", "camera_id": "0"}


@router.post("/file")
async def start_file_default(req: FileSourceRequest):
    from backend.main import get_or_create_stream_manager
    mgr = await get_or_create_stream_manager("0")
    try:
        await mgr.start_file(path=req.path, loop=req.loop, frame_interval_ms=req.frame_interval_ms)
        return {"status": "started", "camera_id": "0", "mode": "file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def camera_status_default():
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr is None:
        return {"camera_id": "0", "running": False}
    return mgr.status()


@router.get("/feed")
async def camera_feed_default():
    from backend.main import get_stream_manager

    async def generate():
        while True:
            mgr = get_stream_manager("0")
            if mgr and mgr.last_jpeg:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + mgr.last_jpeg
                    + b"\r\n"
                )
            await asyncio.sleep(1 / 15)

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
