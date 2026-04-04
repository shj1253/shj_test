"""
스트리밍 매니저 — 카메라/파일 루프 + WebSocket 브로드캐스트
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import cv2
import numpy as np

from backend.active_learning.al_engine import ALEngine
from backend.api.websocket.manager import ws_manager
from backend.camera.camera_source import CameraSource, FileSource, OpenCVCamera
from backend.core.pipeline import InferencePipeline
from backend.logging_config import get_logger
from backend.metrics.realtime_tracker import RealtimeMetricsTracker

logger = get_logger(__name__)


class StreamManager:
    """
    실시간 프레임 루프 관리

    - Camera or File 소스에서 프레임 읽기
    - 파이프라인 추론 실행
    - WebSocket으로 결과 브로드캐스트
    - AL 엔진에 샘플 전달
    - 메트릭 추적
    """

    def __init__(
        self,
        pipeline: InferencePipeline,
        metrics_tracker: RealtimeMetricsTracker,
        al_engine: ALEngine | None = None,
    ) -> None:
        self.pipeline = pipeline
        self.metrics_tracker = metrics_tracker
        self.al_engine = al_engine

        self._source: CameraSource | None = None
        self._task: asyncio.Task | None = None
        self._running: bool = False
        self._mode: str = "idle"
        self._frame_count: int = 0
        self._error_count: int = 0
        self.last_jpeg: bytes | None = None

    # ── 시작 / 중지 ────────────────────────────────────────────────────────

    async def start_camera(
        self,
        device_id: int = 0,
        fps: int = 30,
        width: int = 1280,
        height: int = 720,
    ) -> None:
        await self.stop()
        self._source = OpenCVCamera(
            device_id=device_id, width=width, height=height, fps=fps
        )
        await self._source.open()
        self._mode = "camera"
        self._start_loop(frame_interval_ms=int(1000 / fps))

    async def start_file(
        self,
        path: str,
        loop: bool = False,
        frame_interval_ms: int = 33,
    ) -> None:
        await self.stop()
        self._source = FileSource(
            path=Path(path), loop=loop, frame_interval_ms=frame_interval_ms
        )
        await self._source.open()
        self._mode = "file"
        self._start_loop(frame_interval_ms=frame_interval_ms)

    def _start_loop(self, frame_interval_ms: int) -> None:
        self._running = True
        self._frame_count = 0
        self._error_count = 0
        self._task = asyncio.create_task(
            self._frame_loop(frame_interval_ms),
            name="stream_loop",
        )
        logger.info("Stream loop started", mode=self._mode)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._source:
            await self._source.close()
            self._source = None
        self._mode = "idle"
        logger.info("Stream stopped")

    # ── 프레임 루프 ────────────────────────────────────────────────────────

    async def _frame_loop(self, frame_interval_ms: int) -> None:
        interval_s = frame_interval_ms / 1000.0

        while self._running:
            loop_start = asyncio.get_event_loop().time()

            try:
                frame = await self._source.read_frame()
                if frame is None:
                    logger.info("Stream source exhausted")
                    self._running = False
                    await ws_manager.broadcast("stream", {"event": "stream_ended"})
                    break

                self._frame_count += 1

                # MJPEG용 JPEG 인코딩 (BGR로 변환 후 인코딩)
                bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                _, jpeg_arr = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
                self.last_jpeg = jpeg_arr.tobytes()

                # 추론 실행
                result = await self.pipeline.run(frame)

                # AL 수집
                if self.al_engine:
                    added = await self.al_engine.process(frame, result)
                    if added:
                        self.metrics_tracker.update_al_queue_size(
                            self.al_engine.queue.stats["unlabeled_count"]
                        )

                # 메트릭 기록
                self.metrics_tracker.record(result)

                # WebSocket 브로드캐스트 (구독자 있을 때만)
                result_dict = result.to_dict()
                result_dict["frame_count"] = self._frame_count
                await ws_manager.broadcast("stream", result_dict)

                # 에러 카운트 리셋
                self._error_count = 0

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error_count += 1
                logger.error(
                    "Frame loop error",
                    error=str(e),
                    error_count=self._error_count,
                    exc_info=True,
                )
                await ws_manager.broadcast("stream", {
                    "event": "error",
                    "message": str(e),
                    "error_count": self._error_count,
                })

                # 연속 에러 10회 이상이면 중단
                if self._error_count >= 10:
                    logger.error("Too many errors, stopping stream")
                    self._running = False
                    break

            # 프레임 레이트 조절
            elapsed = asyncio.get_event_loop().time() - loop_start
            sleep_time = max(0.0, interval_s - elapsed)
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    # ── 메트릭 브로드캐스트 태스크 ────────────────────────────────────────

    async def metrics_broadcast_loop(self, interval_s: float = 1.0) -> None:
        """1초 주기로 메트릭 스냅샷을 WebSocket으로 브로드캐스트"""
        while True:
            try:
                snapshot = self.metrics_tracker.current_metrics
                await ws_manager.broadcast("metrics", snapshot.to_dict())
            except Exception as e:
                logger.warning("Metrics broadcast error", error=str(e))
            await asyncio.sleep(interval_s)

    # ── 상태 ──────────────────────────────────────────────────────────────

    def status(self) -> dict:
        return {
            "running": self._running,
            "mode": self._mode,
            "frame_count": self._frame_count,
            "error_count": self._error_count,
            "source_info": self._source.get_info() if self._source else None,
            "ws_connections": ws_manager.all_counts(),
        }
