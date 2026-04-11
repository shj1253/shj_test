"""
스트리밍 매니저 — 카메라/파일 루프 + WebSocket 브로드캐스트
"""
from __future__ import annotations

import asyncio
from datetime import datetime
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

# 연속 N프레임 같은 타겟이어야 알림 발송 (오탐 방지)
DEBOUNCE_FRAMES = 3


class StreamManager:
    """
    실시간 프레임 루프 관리

    - Camera or File 소스에서 프레임 읽기
    - 파이프라인 추론 실행
    - WebSocket으로 결과 브로드캐스트 (채널: stream_{camera_id})
    - 디바운싱 + 상태 전환 감지 → alerts 채널에 알림 발송
    - AL 엔진에 샘플 전달
    - 메트릭 추적
    """

    def __init__(
        self,
        pipeline: InferencePipeline,
        metrics_tracker: RealtimeMetricsTracker,
        al_engine: ALEngine | None = None,
        camera_id: str = "0",
    ) -> None:
        self.pipeline = pipeline
        self.metrics_tracker = metrics_tracker
        self.al_engine = al_engine
        self.camera_id = camera_id

        self._source: CameraSource | None = None
        self._task: asyncio.Task | None = None
        self._running: bool = False
        self._mode: str = "idle"
        self._frame_count: int = 0
        self._error_count: int = 0
        self._last_error: str | None = None

        # MJPEG용 마지막 JPEG 프레임
        self.last_jpeg: bytes | None = None
        self._frame_seq: int = 0

        # 추론 분리 — 디스플레이와 추론 비동기 병렬 실행
        self._inference_task: asyncio.Task | None = None
        self._inference_busy: bool = False

        # 알림 디바운싱
        self._debounce_votes: dict[int, int] = {}  # target_id → 연속 프레임 수
        self._last_alert_target: int | None = None  # 마지막으로 알림 발송한 target_id
        self._alert_occurrence: dict[int, int] = {}  # target_id → 총 감지 횟수
        self._pending_alert: dict | None = None     # 다음 브로드캐스트에 첨부할 알림

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

    async def start_rtsp(self, url: str, frame_interval_ms: int = 33) -> None:
        """RTSP / IP 카메라 URL (rtsp:// or http://) 스트림 시작"""
        from backend.camera.camera_source import RtspSource
        await self.stop()
        self._source = RtspSource(url=url)
        await self._source.open()
        self._mode = "rtsp"
        self._start_loop(frame_interval_ms=frame_interval_ms)

    def _start_loop(self, frame_interval_ms: int) -> None:
        self._running = True
        self._frame_count = 0
        self._error_count = 0
        self._debounce_votes.clear()
        self._alert_occurrence.clear()
        self._last_alert_target = None
        self._pending_alert = None
        self._task = asyncio.create_task(
            self._frame_loop(frame_interval_ms),
            name=f"stream_loop_{self.camera_id}",
        )
        logger.info("Stream loop started", camera_id=self.camera_id, mode=self._mode)

    async def stop(self) -> None:
        self._running = False
        if self._inference_task and not self._inference_task.done():
            self._inference_task.cancel()
            try:
                await self._inference_task
            except asyncio.CancelledError:
                pass
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
        self._inference_busy = False
        logger.info("Stream stopped", camera_id=self.camera_id)

    # ── 프레임 루프 ────────────────────────────────────────────────────────

    async def _frame_loop(self, frame_interval_ms: int) -> None:
        """디스플레이 + 추론 분리 루프.

        매 프레임: JPEG 인코딩 즉시 수행 (디스플레이용, ~2ms)
        추론: 이전 추론이 끝났을 때만 새 프레임으로 실행 (비동기 병렬)
        → 화면은 카메라 FPS 그대로 부드럽게, 추론은 자기 속도대로.
        """
        interval_s = frame_interval_ms / 1000.0

        while self._running:
            loop_start = asyncio.get_event_loop().time()

            try:
                frame = await self._source.read_frame()
                if frame is None:
                    logger.info("Stream source exhausted", camera_id=self.camera_id)
                    self._running = False
                    await ws_manager.broadcast(f"stream_{self.camera_id}", {"event": "stream_ended"})
                    break

                self._frame_count += 1

                # ── 디스플레이: JPEG 인코딩 즉시 수행 (원본 해상도) ──
                bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                _, jpeg_arr = cv2.imencode('.jpg', bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
                self.last_jpeg = jpeg_arr.tobytes()
                self._frame_seq += 1

                # ── 추론: 이전 추론이 끝났으면 새 프레임으로 시작 ──
                if not self._inference_busy:
                    self._inference_busy = True
                    self._inference_task = asyncio.create_task(
                        self._run_inference(frame, self._frame_count)
                    )

                self._error_count = 0

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error_count += 1
                self._last_error = str(e)
                logger.error(
                    "Frame loop error",
                    camera_id=self.camera_id,
                    error=str(e),
                    error_count=self._error_count,
                    exc_info=True,
                )
                await ws_manager.broadcast(f"stream_{self.camera_id}", {
                    "event": "error",
                    "camera_id": self.camera_id,
                    "message": str(e),
                    "error_count": self._error_count,
                })

                if self._error_count >= 10:
                    logger.error("Too many errors, stopping stream", camera_id=self.camera_id)
                    self._running = False
                    break

                backoff_s = min(5.0, 0.1 * (2 ** min(self._error_count - 1, 5)))
                await asyncio.sleep(backoff_s)
                continue

            # 프레임 레이트 조절 (카메라 모드만 — 파일은 리더 스레드가 FPS 제어)
            if self._mode != "file":
                elapsed = asyncio.get_event_loop().time() - loop_start
                sleep_time = max(0.0, interval_s - elapsed)
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

    async def _run_inference(self, frame: np.ndarray, frame_count: int) -> None:
        """추론 + 알림 + 메트릭 + WS 브로드캐스트 (디스플레이 루프와 병렬 실행)"""
        try:
            result = await self.pipeline.run(frame)

            # 알림 디바운싱 처리
            await self._process_alert(result)

            # AL 수집
            if self.al_engine:
                added = await self.al_engine.process(frame, result)
                if added:
                    self.metrics_tracker.update_al_queue_size(
                        self.al_engine.queue.stats["unlabeled_count"]
                    )

            # 메트릭 기록
            self.metrics_tracker.record(result)

            # WebSocket 브로드캐스트 — 클라이언트 있을 때만 직렬화
            stream_ch = f"stream_{self.camera_id}"
            if ws_manager.connection_count(stream_ch) > 0:
                result_dict = result.to_dict()
                result_dict["frame_count"] = frame_count
                result_dict["camera_id"] = self.camera_id

                if self._pending_alert:
                    result_dict["alert"] = self._pending_alert
                    self._pending_alert = None

                await ws_manager.broadcast(stream_ch, result_dict)

        except Exception as e:
            logger.error("Inference error", camera_id=self.camera_id, error=str(e))
        finally:
            self._inference_busy = False

    async def _process_alert(self, result) -> None:
        """
        디바운싱 + 상태 전환 감지 → 알림 발송

        - Gate 통과 + 분류 결과가 DEBOUNCE_FRAMES 연속으로 같은 타겟이면 알림
        - 이전과 다른 타겟일 때만 발송 (같은 화면 반복 알림 방지)
        - OOD(타겟 없음) 프레임이 누적되면 last_alert_target 리셋
        """
        from backend.target_meta import get_meta

        if result.gate_result.is_target and result.classify_result:
            tid = result.classify_result.target_id
            # 현재 타겟 투표 증가
            self._debounce_votes[tid] = self._debounce_votes.get(tid, 0) + 1
            # 다른 타겟 투표 감소
            for k in list(self._debounce_votes):
                if k != tid:
                    self._debounce_votes[k] = max(0, self._debounce_votes[k] - 1)

            # 연속 N프레임 확인 + 이전과 다른 타겟
            if (self._debounce_votes[tid] >= DEBOUNCE_FRAMES
                    and tid != self._last_alert_target):
                self._last_alert_target = tid
                self._debounce_votes[tid] = 0  # C-1 fix: 발화 후 리셋 → 단일 프레임 재발화 방지
                self._alert_occurrence[tid] = self._alert_occurrence.get(tid, 0) + 1
                meta = get_meta(tid)
                alert = {
                    "event": "alert",
                    "camera_id": self.camera_id,
                    "target_id": tid,
                    "target_name": meta["name"],
                    "screen_desc": meta["screen_desc"],
                    "situation": meta["situation"],
                    "action": meta["action"],
                    "action_steps": meta.get("action_steps", []),
                    "urgency": meta.get("urgency", ""),
                    "severity": meta["severity"],
                    "occurrence_count": self._alert_occurrence[tid],
                    "frame_count": self._frame_count,
                    "timestamp": datetime.now().isoformat(),
                }
                self._pending_alert = alert
                await ws_manager.broadcast("alerts", alert)
                logger.info(
                    "Alert fired",
                    camera_id=self.camera_id,
                    target_id=tid,
                    severity=meta["severity"],
                )
        else:
            # OOD — 모든 투표 감소
            for k in list(self._debounce_votes):
                self._debounce_votes[k] = max(0, self._debounce_votes[k] - 1)
            # 투표가 모두 0이면 last_alert_target 리셋 (화면에서 완전히 사라진 것)
            if all(v == 0 for v in self._debounce_votes.values()):
                self._last_alert_target = None

    # ── 메트릭 브로드캐스트 태스크 ────────────────────────────────────────

    async def metrics_broadcast_loop(self, interval_s: float = 1.0) -> None:
        """1초 주기로 메트릭 스냅샷을 WebSocket으로 브로드캐스트"""
        while True:
            try:
                snapshot = self.metrics_tracker.current_metrics
                data = snapshot.to_dict()
                data["camera_id"] = self.camera_id
                data["stream_running"] = self._running  # 스트림 상태를 함께 전송
                await ws_manager.broadcast("metrics", data)
            except Exception as e:
                logger.warning("Metrics broadcast error", camera_id=self.camera_id, error=str(e))
            await asyncio.sleep(interval_s)

    # ── 상태 ──────────────────────────────────────────────────────────────

    def status(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "running": self._running,
            "mode": self._mode,
            "frame_count": self._frame_count,
            "error_count": self._error_count,
            "last_error": self._last_error,
            "has_frame": self.last_jpeg is not None,
            "last_alert_target": self._last_alert_target,
            "source_info": self._source.get_info() if self._source else None,
            "ws_connections": ws_manager.all_counts(),
        }
