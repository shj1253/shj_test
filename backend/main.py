"""
FastAPI 앱 진입점
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.active_learning.al_engine import ALEngine
from backend.api.routes import active_learning, camera, inference, metrics, models, training
from backend.api.websocket.manager import ws_manager
from backend.config import settings
from backend.core.pipeline import InferencePipeline
from backend.core.state_machine import SequenceStateMachine
from backend.exceptions import CannonBaseError
from backend.logging_config import get_logger, setup_logging
from backend.metrics.realtime_tracker import RealtimeMetricsTracker
from backend.models.registry import registry
from backend.stream_manager import StreamManager

setup_logging(settings.log_level)
logger = get_logger(__name__)

# ── 글로벌 상태 ───────────────────────────────────────────────────────────

_pipeline: InferencePipeline | None = None
_metrics_tracker: RealtimeMetricsTracker | None = None
_al_engine: ALEngine | None = None
_stream_manager: StreamManager | None = None
_metrics_broadcast_task: asyncio.Task | None = None


def get_pipeline() -> InferencePipeline | None:
    return _pipeline

def get_metrics_tracker() -> RealtimeMetricsTracker | None:
    return _metrics_tracker

def get_al_engine() -> ALEngine | None:
    return _al_engine

def get_stream_manager() -> StreamManager | None:
    return _stream_manager


async def reinit_pipeline() -> None:
    """모델 교체 후 파이프라인 재초기화"""
    global _pipeline, _stream_manager

    gate = registry.active_gate
    clf = registry.active_classifier
    sm = SequenceStateMachine(
        on_target_detected=lambda tid, state: logger.info(
            "Target detected", target_id=tid, new_state=state
        ),
        on_complete=lambda: logger.info("All targets COMPLETE"),
        on_violation=lambda tid, state, reason: logger.warning(
            "Sequence violation", target_id=tid, state=state, reason=reason
        ),
    )

    _pipeline = InferencePipeline(gate=gate, classifier=clf, state_machine=sm)

    if _stream_manager:
        _stream_manager.pipeline = _pipeline

    logger.info("Pipeline reinitialized")


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 / 종료 시 리소스 관리"""
    global _pipeline, _metrics_tracker, _al_engine, _stream_manager
    global _metrics_broadcast_task

    logger.info("Canon Project API starting up")
    settings.ensure_dirs()

    # 메트릭 트래커 초기화
    _metrics_tracker = RealtimeMetricsTracker(window_size=settings.metrics_window_size)

    # AL 엔진 초기화
    _al_engine = ALEngine()

    # 기본 모델 생성 (미학습 상태 — 학습/로드 후 사용)
    gate = registry.create_gate(settings.gate_model)
    clf = registry.create_classifier(backbone=settings.classifier_backbone)
    registry.register_gate("gate_a", gate)
    registry.register_classifier("classifier", clf)

    sm = SequenceStateMachine(
        num_targets=settings.num_targets,
        on_target_detected=lambda tid, state: logger.info(
            "Target detected", target_id=tid, new_state=state
        ),
        on_complete=lambda: logger.info("Sequence COMPLETE"),
        on_violation=lambda tid, state, reason: logger.warning(
            "Violation", tid=tid, state=state, reason=reason
        ),
    )
    _pipeline = InferencePipeline(gate=gate, classifier=clf, state_machine=sm)
    _stream_manager = StreamManager(
        pipeline=_pipeline,
        metrics_tracker=_metrics_tracker,
        al_engine=_al_engine,
    )

    # 메트릭 브로드캐스트 루프 시작
    _metrics_broadcast_task = asyncio.create_task(
        _stream_manager.metrics_broadcast_loop(interval_s=1.0),
        name="metrics_broadcast",
    )

    logger.info("Canon Project API ready", host=settings.host, port=settings.port)

    yield  # ← 여기서 앱이 실행됨

    # 종료 정리
    logger.info("Shutting down")
    if _stream_manager:
        await _stream_manager.stop()
    if _metrics_broadcast_task:
        _metrics_broadcast_task.cancel()


# ── FastAPI 앱 ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Canon Project API",
    description="실시간 Target 이미지 검출 시스템",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — settings.allowed_origins 환경변수로 제어 (기본 "*")
_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ───────────────────────────────────────────────────────────

app.include_router(inference.router)
app.include_router(camera.router)
app.include_router(models.router)
app.include_router(active_learning.router)
app.include_router(metrics.router)
app.include_router(training.router)


# ── 헬스체크 ─────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health():
    return {
        "status": "ok",
        "pipeline": _pipeline is not None,
        "models": registry.list_gates() + registry.list_classifiers(),
    }


@app.get("/", tags=["system"])
async def root():
    return {"message": "Canon Project API", "docs": "/docs"}


# ── 전역 예외 핸들러 ──────────────────────────────────────────────────────

@app.exception_handler(CannonBaseError)
async def cannon_exception_handler(request, exc: CannonBaseError):
    logger.error("Domain error", error=exc.message, detail=exc.detail)
    return JSONResponse(
        status_code=400,
        content={"error": exc.message, "detail": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc: Exception):
    logger.error("Unhandled error", error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


# ── WebSocket 엔드포인트 ──────────────────────────────────────────────────

@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket):
    """실시간 추론 결과 스트림"""
    await ws_manager.connect(websocket, "stream")
    try:
        while True:
            await websocket.receive_text()  # heartbeat ping 수신
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "stream")


@app.websocket("/ws/metrics")
async def ws_metrics(websocket: WebSocket):
    """실시간 메트릭 스트림"""
    await ws_manager.connect(websocket, "metrics")
    # 연결 즉시 현재 스냅샷 전송
    if _metrics_tracker:
        import json
        await websocket.send_text(
            json.dumps(_metrics_tracker.current_metrics.to_dict(), default=str)
        )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "metrics")


@app.websocket("/ws/al")
async def ws_al(websocket: WebSocket):
    """AL 큐 상태 실시간 알림"""
    await ws_manager.connect(websocket, "al")
    try:
        while True:
            data = await websocket.receive_json()
            # 클라이언트에서 레이블 제출 가능 (양방향)
            if data.get("action") == "label" and _al_engine:
                sample_id = data.get("sample_id")
                label = data.get("label")
                if sample_id is not None and label is not None:
                    try:
                        _al_engine.queue.label(sample_id, label)
                        await ws_manager.broadcast("al", {
                            "event": "labeled",
                            "sample_id": sample_id,
                            "label": label,
                            "stats": _al_engine.stats,
                        })
                    except Exception as e:
                        await websocket.send_json({"error": str(e)})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "al")


# ── 실행 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
