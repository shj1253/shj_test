"""
WebSocket 연결 관리자 — 채널별 브로드캐스트
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from backend.logging_config import get_logger

logger = get_logger(__name__)


class ConnectionManager:
    """
    WebSocket 연결 풀 관리

    채널:
    - "stream"  : 프레임별 추론 결과 (InferenceResult JSON)
    - "metrics" : 실시간 지표 스냅샷 (1초 주기)
    - "al"      : Active Learning 큐 상태 변경
    """

    def __init__(self) -> None:
        # channel → set of websockets
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        await websocket.accept()
        self._connections[channel].add(websocket)
        logger.info(
            "WebSocket connected",
            channel=channel,
            total=len(self._connections[channel]),
        )

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        self._connections[channel].discard(websocket)
        logger.info(
            "WebSocket disconnected",
            channel=channel,
            remaining=len(self._connections[channel]),
        )

    async def broadcast(self, channel: str, data: Any) -> None:
        """특정 채널 구독자 전체에게 JSON 메시지 전송"""
        connections = list(self._connections.get(channel, set()))
        if not connections:
            return

        if isinstance(data, dict):
            message = json.dumps(data, ensure_ascii=False, default=str)
        else:
            message = json.dumps({"data": str(data)})

        dead: list[WebSocket] = []
        await asyncio.gather(
            *[self._safe_send(ws, message, dead) for ws in connections],
            return_exceptions=True,
        )

        for ws in dead:
            self._connections[channel].discard(ws)

    async def _safe_send(
        self, ws: WebSocket, message: str, dead: list[WebSocket]
    ) -> None:
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)

    def connection_count(self, channel: str) -> int:
        return len(self._connections.get(channel, set()))

    def all_counts(self) -> dict[str, int]:
        return {ch: len(conns) for ch, conns in self._connections.items()}


# 싱글턴 인스턴스
ws_manager = ConnectionManager()
