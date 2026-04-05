"""
카메라 소스 추상 기반 클래스
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

import cv2
import numpy as np

from backend.exceptions import CameraNotOpenedError, CameraReadError, FileSourceError
from backend.logging_config import get_logger

logger = get_logger(__name__)


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


class OpenCVCamera(CameraSource):
    """실시간 카메라 (OpenCV)"""

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

    async def open(self) -> None:
        self._cap = cv2.VideoCapture(self.device_id)
        if not self._cap.isOpened():
            raise CameraNotOpenedError(
                f"Cannot open camera device {self.device_id}"
            )
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._cap.set(cv2.CAP_PROP_FPS, self.fps)
        logger.info("Camera opened", device_id=self.device_id, fps=self.fps)

    async def read_frame(self) -> np.ndarray | None:
        if not self._cap or not self._cap.isOpened():
            raise CameraNotOpenedError("Camera not opened")
        ret, frame = self._cap.read()
        if not ret:
            raise CameraReadError("Failed to read frame from camera")
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    async def close(self) -> None:
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


class FileSource(CameraSource):
    """이미지/영상 파일 소스 (테스트 모드)"""

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

    async def open(self) -> None:
        if not self.path.exists():
            raise FileSourceError(f"File not found: {self.path}")

        suffix = self.path.suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}:
            # 단일 이미지
            img = cv2.imread(str(self.path))
            if img is None:
                raise FileSourceError(f"Cannot read image: {self.path}")
            self._images = [cv2.cvtColor(img, cv2.COLOR_BGR2RGB)]
            self._is_video = False
        elif suffix in {".mp4", ".avi", ".mov", ".mkv", ".wmv"}:
            # 영상
            self._cap = cv2.VideoCapture(str(self.path))
            if not self._cap.isOpened():
                raise FileSourceError(f"Cannot open video: {self.path}")
            self._is_video = True
        elif self.path.is_dir():
            # 디렉터리 내 이미지들
            exts = {".jpg", ".jpeg", ".png", ".bmp"}
            files = sorted([f for f in self.path.iterdir() if f.suffix.lower() in exts])
            if not files:
                raise FileSourceError(f"No images found in: {self.path}")
            for f in files:
                img = cv2.imread(str(f))
                if img is not None:
                    self._images.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            self._is_video = False
        else:
            raise FileSourceError(f"Unsupported file type: {suffix}")

        self._opened = True
        logger.info(
            "FileSource opened",
            path=str(self.path),
            is_video=self._is_video,
            n_images=len(self._images) if not self._is_video else "video",
        )

    async def read_frame(self) -> np.ndarray | None:
        if not self._opened:
            raise FileSourceError("FileSource not opened")

        if self._is_video:
            assert self._cap is not None
            ret, frame = self._cap.read()
            if not ret:
                if self.loop:
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret, frame = self._cap.read()
                    if not ret:
                        return None
                else:
                    return None
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
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
            "frame_interval_ms": self.frame_interval_ms,
            "is_video": self._is_video,
            "is_opened": self._opened,
        }


class RtspSource(CameraSource):
    """RTSP / IP 카메라 URL 소스"""

    def __init__(self, url: str) -> None:
        self.url = url
        self._cap: cv2.VideoCapture | None = None

    async def open(self) -> None:
        self._cap = cv2.VideoCapture(self.url)
        if not self._cap.isOpened():
            raise FileSourceError(f"RTSP 연결 실패: {self.url}")
        logger.info("RTSP source opened", url=self.url)

    async def read_frame(self) -> np.ndarray | None:
        if not self._cap or not self._cap.isOpened():
            return None
        ret, frame = self._cap.read()
        if not ret:
            return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    async def close(self) -> None:
        if self._cap:
            self._cap.release()
            self._cap = None

    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def get_info(self) -> dict:
        return {"type": "rtsp", "url": self.url, "is_opened": self.is_opened()}
