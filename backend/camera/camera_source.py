"""
카메라 소스 추상 기반 클래스

프레임 읽기 구조:
  - 전용 reader 스레드가 백그라운드에서 cap.read() 루프 실행
  - 읽은 프레임을 asyncio.Queue에 push
  - read_frame()은 queue.get()으로 꺼내기만 함 → 이벤트 루프 블로킹 없음
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from abc import ABC, abstractmethod
from pathlib import Path

import cv2
import numpy as np

from backend.exceptions import CameraNotOpenedError, CameraReadError, FileSourceError
from backend.logging_config import get_logger

logger = get_logger(__name__)

# 파일 재생: 순서 보장 버퍼 (모든 프레임 처리)
_FILE_QUEUE_MAXSIZE = 8
# 실시간: 최신 프레임 우선 (느리면 드롭)
_LIVE_QUEUE_MAXSIZE = 1


class CameraSource(ABC):
    """카메라/파일 입력 소스 ABC"""

    @abstractmethod
    async def open(self) -> None: ...

    @abstractmethod
    async def read_frame(self) -> np.ndarray | None:
        """프레임 읽기. 스트림 끝이면 None 반환."""

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    def is_opened(self) -> bool: ...

    @abstractmethod
    def get_info(self) -> dict: ...


# ── 공통 유틸 ──────────────────────────────────────────────────────────────

def _drain_queue(q: asyncio.Queue) -> None:
    """큐를 비워 reader 스레드의 put() 블로킹 해제"""
    while True:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            break


def _start_reader(
    target,
    loop: asyncio.AbstractEventLoop,
    name: str,
) -> threading.Thread:
    t = threading.Thread(target=target, args=(loop,), daemon=True, name=name)
    t.start()
    return t


# ── OpenCVCamera ───────────────────────────────────────────────────────────

class OpenCVCamera(CameraSource):
    """실시간 카메라 (OpenCV) — 전용 reader 스레드"""

    def __init__(
        self,
        device_id: int = 0,
        width: int = 1280,
        height: int = 720,
        fps: int = 30,
    ) -> None:
        self.device_id = device_id
        self.width = width
        self.height = height
        self.fps = fps
        self._cap: cv2.VideoCapture | None = None
        self._queue: asyncio.Queue | None = None
        self._stop_evt = threading.Event()
        self._thread: threading.Thread | None = None

    async def open(self) -> None:
        device_id, width, height, fps = self.device_id, self.width, self.height, self.fps

        def _open():
            cap = cv2.VideoCapture(device_id)
            if not cap.isOpened():
                raise CameraNotOpenedError(f"카메라 {device_id}번 열기 실패")
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            cap.set(cv2.CAP_PROP_FPS, fps)
            return cap

        self._cap = await asyncio.to_thread(_open)
        loop = asyncio.get_event_loop()
        # 실시간: 큐 크기 1 — 추론이 느려도 항상 최신 프레임만 처리
        self._queue = asyncio.Queue(maxsize=_LIVE_QUEUE_MAXSIZE)
        self._stop_evt.clear()
        self._thread = _start_reader(self._reader_loop, loop, f"cam_reader_{device_id}")
        logger.info("Camera opened", device_id=device_id, fps=fps)

    def _reader_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """전용 reader 스레드: cap.read() → queue.put() (최신 프레임 우선, 느리면 드롭)"""
        assert self._cap and self._queue

        async def _replace(frame: np.ndarray) -> None:
            """큐를 비우고 최신 프레임 push — 항상 최신 1프레임만 유지"""
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            await self._queue.put(frame)

        while not self._stop_evt.is_set():
            ret, frame = self._cap.read()
            if not ret:
                asyncio.run_coroutine_threadsafe(self._queue.put(None), loop)
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            fut = asyncio.run_coroutine_threadsafe(_replace(rgb), loop)
            try:
                fut.result(timeout=0.5)
            except concurrent.futures.TimeoutError:
                continue
            except Exception:
                break

    async def read_frame(self) -> np.ndarray | None:
        if not self._queue:
            raise CameraNotOpenedError("Camera not opened")
        return await self._queue.get()

    async def close(self) -> None:
        self._stop_evt.set()
        if self._queue:
            _drain_queue(self._queue)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
            self._cap = None
        logger.info("Camera closed", device_id=self.device_id)

    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def get_info(self) -> dict:
        return {
            "type": "camera",
            "device_id": self.device_id,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "is_opened": self.is_opened(),
        }


# ── FileSource ─────────────────────────────────────────────────────────────

class FileSource(CameraSource):
    """영상/이미지 파일 소스 — 영상은 전용 reader 스레드, 이미지는 직접 반환"""

    def __init__(
        self,
        path: str | Path,
        loop: bool = False,
        frame_interval_ms: int = 33,
    ) -> None:
        self.path = Path(path)
        self.loop = loop
        self.frame_interval_ms = frame_interval_ms

        self._cap: cv2.VideoCapture | None = None
        self._images: list[np.ndarray] = []
        self._img_idx: int = 0
        self._is_video: bool = False
        self._opened: bool = False
        self._video_fps: float = 30.0
        self._queue: asyncio.Queue | None = None
        self._stop_evt = threading.Event()
        self._thread: threading.Thread | None = None

    async def open(self) -> None:
        if not self.path.exists():
            raise FileSourceError(f"파일 없음: {self.path}")

        suffix = self.path.suffix.lower()

        if suffix in {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}:
            def _load():
                img = cv2.imread(str(self.path))
                if img is None:
                    raise FileSourceError(f"이미지 열기 실패: {self.path.name}")
                return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            self._images = [await asyncio.to_thread(_load)]
            self._is_video = False

        elif suffix in {".mp4", ".avi", ".mov", ".mkv", ".wmv"}:
            def _open_video():
                cap = cv2.VideoCapture(str(self.path))
                if not cap.isOpened():
                    raise FileSourceError(f"영상 열기 실패: {self.path.name}")
                ret, _ = cap.read()
                if not ret:
                    cap.release()
                    raise FileSourceError(
                        f"첫 프레임 읽기 실패: {self.path.name} — "
                        "지원하지 않는 코덱입니다. H.264 mp4 또는 XVID avi를 사용하세요."
                    )
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                fps = cap.get(cv2.CAP_PROP_FPS)
                return cap, fps if fps > 0 else 30.0
            self._cap, self._video_fps = await asyncio.to_thread(_open_video)
            self._is_video = True

            loop = asyncio.get_event_loop()
            # 실시간 속도 재생: 큐 1개, 처리 못 따라가면 프레임 드롭
            self._queue = asyncio.Queue(maxsize=_LIVE_QUEUE_MAXSIZE)
            self._stop_evt.clear()
            self._thread = _start_reader(
                self._reader_loop, loop, f"file_reader_{self.path.name}"
            )

        elif self.path.is_dir():
            exts = {".jpg", ".jpeg", ".png", ".bmp"}
            files = sorted(f for f in self.path.iterdir() if f.suffix.lower() in exts)
            if not files:
                raise FileSourceError(f"이미지 없음: {self.path}")
            def _load_dir():
                imgs = []
                for f in files:
                    img = cv2.imread(str(f))
                    if img is not None:
                        imgs.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                return imgs
            self._images = await asyncio.to_thread(_load_dir)
            self._is_video = False

        else:
            raise FileSourceError(f"지원하지 않는 파일 형식: {suffix}")

        self._opened = True
        logger.info(
            "FileSource opened",
            path=str(self.path),
            is_video=self._is_video,
            n_images=len(self._images) if not self._is_video else "video",
        )

    def _reader_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """전용 reader 스레드: 네이티브 FPS로 읽고, 처리 못 따라가면 프레임 드롭"""
        import time
        assert self._cap and self._queue
        spf = 1.0 / self._video_fps  # seconds per frame

        async def _replace(frame: np.ndarray) -> None:
            """큐를 비우고 최신 프레임만 유지 — 처리 지연 시 프레임 드롭"""
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            await self._queue.put(frame)

        while not self._stop_evt.is_set():
            t0 = time.monotonic()
            ret, frame = self._cap.read()
            if not ret:
                if self.loop:
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                asyncio.run_coroutine_threadsafe(self._queue.put(None), loop)
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            fut = asyncio.run_coroutine_threadsafe(_replace(rgb), loop)
            try:
                fut.result(timeout=0.5)
            except concurrent.futures.TimeoutError:
                continue
            except Exception:
                break
            # 네이티브 FPS에 맞춰 다음 프레임까지 대기
            elapsed = time.monotonic() - t0
            wait = spf - elapsed
            if wait > 0:
                time.sleep(wait)

    async def read_frame(self) -> np.ndarray | None:
        if not self._opened:
            raise FileSourceError("FileSource not opened")

        if self._is_video:
            # 큐에서 다음 프레임 대기 — 이벤트 루프를 블로킹하지 않음
            assert self._queue
            return await self._queue.get()
        else:
            if self._img_idx >= len(self._images):
                if self.loop:
                    self._img_idx = 0
                else:
                    return None
            frame = self._images[self._img_idx]
            self._img_idx += 1
            return frame

    async def close(self) -> None:
        self._stop_evt.set()
        if self._queue:
            _drain_queue(self._queue)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
            self._cap = None
        self._opened = False
        logger.info("FileSource closed", path=str(self.path))

    def is_opened(self) -> bool:
        return self._opened

    def get_info(self) -> dict:
        return {
            "type": "file",
            "path": str(self.path),
            "loop": self.loop,
            "fps": self._video_fps,
            "is_video": self._is_video,
            "is_opened": self._opened,
            "queue_size": self._queue.qsize() if self._queue else 0,
        }


# ── RtspSource ─────────────────────────────────────────────────────────────

class RtspSource(CameraSource):
    """RTSP / IP 카메라 URL 소스 — 전용 reader 스레드"""

    def __init__(self, url: str) -> None:
        self.url = url
        self._cap: cv2.VideoCapture | None = None
        self._queue: asyncio.Queue | None = None
        self._stop_evt = threading.Event()
        self._thread: threading.Thread | None = None

    async def open(self) -> None:
        def _open():
            cap = cv2.VideoCapture(self.url)
            if not cap.isOpened():
                raise FileSourceError(f"RTSP 연결 실패: {self.url}")
            return cap

        self._cap = await asyncio.to_thread(_open)
        loop = asyncio.get_event_loop()
        self._queue = asyncio.Queue(maxsize=_LIVE_QUEUE_MAXSIZE)
        self._stop_evt.clear()
        self._thread = _start_reader(self._reader_loop, loop, "rtsp_reader")
        logger.info("RTSP source opened", url=self.url)

    def _reader_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        assert self._cap and self._queue

        async def _replace(frame: np.ndarray) -> None:
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            await self._queue.put(frame)

        while not self._stop_evt.is_set():
            ret, frame = self._cap.read()
            if not ret:
                asyncio.run_coroutine_threadsafe(self._queue.put(None), loop)
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            fut = asyncio.run_coroutine_threadsafe(_replace(rgb), loop)
            try:
                fut.result(timeout=0.5)
            except concurrent.futures.TimeoutError:
                continue
            except Exception:
                break

    async def read_frame(self) -> np.ndarray | None:
        if not self._queue:
            return None
        return await self._queue.get()

    async def close(self) -> None:
        self._stop_evt.set()
        if self._queue:
            _drain_queue(self._queue)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
            self._cap = None

    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def get_info(self) -> dict:
        return {
            "type": "rtsp",
            "url": self.url,
            "is_opened": self.is_opened(),
            "queue_size": self._queue.qsize() if self._queue else 0,
        }
