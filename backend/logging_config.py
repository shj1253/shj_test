"""
구조화된 로깅 설정 — structlog 기반
"""
from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def setup_logging(log_level: str = "INFO") -> None:
    """
    structlog 전역 설정.
    개발: 컬러 콘솔 출력
    운영: JSON 출력 (로그 집계 도구 연동 가능)
    """
    level = getattr(logging, log_level.upper(), logging.INFO)

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()),
        ],
    )

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(level)

    # 불필요한 라이브러리 로그 억제
    for noisy in ["uvicorn.access", "multipart"]:
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """모듈별 로거 반환"""
    return structlog.get_logger(name)


# ── 로그 컨텍스트 바인딩 헬퍼 ──────────────────────────────────────────────

def bind_frame_context(frame_id: str, stage: str, model: str | None = None) -> None:
    """현재 async context에 프레임 추적 정보를 바인딩"""
    ctx: dict[str, Any] = {"frame_id": frame_id, "pipeline_stage": stage}
    if model:
        ctx["model"] = model
    structlog.contextvars.bind_contextvars(**ctx)


def clear_frame_context() -> None:
    """프레임 처리 완료 후 컨텍스트 초기화"""
    structlog.contextvars.clear_contextvars()
