"""
추론 REST API — 이미지/배치 파일 업로드 추론
"""
from __future__ import annotations

import io
import asyncio
from typing import Annotated

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from PIL import Image

from backend.core.pipeline import InferenceResult
from backend.exceptions import ModelNotLoadedError, InferenceError
from backend.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/infer", tags=["inference"])


def _load_image(file_bytes: bytes) -> np.ndarray:
    """업로드 바이트 → numpy RGB 배열"""
    try:
        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        return np.array(img)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image file: {e}",
        )


@router.post("/")
async def infer_single(
    file: Annotated[UploadFile, File(description="이미지 파일 (jpg/png)")],
):
    """단일 이미지 추론"""
    from backend.main import get_pipeline, get_al_engine, get_metrics_tracker

    pipeline = get_pipeline()
    if pipeline is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pipeline not initialized. Load models first.",
        )

    file_bytes = await file.read()
    frame = _load_image(file_bytes)

    try:
        result = await pipeline.run(frame)
    except ModelNotLoadedError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("Inference error", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    # AL 수집
    al_engine = get_al_engine()
    if al_engine:
        await al_engine.process(frame, result)

    # 메트릭 기록
    tracker = get_metrics_tracker()
    if tracker:
        tracker.record(result)

    return JSONResponse(content=result.to_dict())


@router.post("/batch")
async def infer_batch(
    files: Annotated[list[UploadFile], File(description="이미지 파일 목록")],
):
    """배치 이미지 추론"""
    from backend.main import get_pipeline

    pipeline = get_pipeline()
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    if len(files) > 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Max 50 files per batch",
        )

    results = []
    for f in files:
        file_bytes = await f.read()
        frame = _load_image(file_bytes)
        try:
            r = await pipeline.run(frame)
            results.append(r.to_dict())
        except Exception as e:
            results.append({"error": str(e), "filename": f.filename})

    return JSONResponse(content={"results": results, "count": len(results)})
