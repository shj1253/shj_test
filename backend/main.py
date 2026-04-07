"""
FastAPI 앱 진입점
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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

# 카메라 ID → StreamManager 매핑 (다중 카메라 지원)
_stream_managers: dict[str, StreamManager] = {}
_metrics_broadcast_tasks: dict[str, asyncio.Task] = {}


def get_stream_manager(camera_id: str = "0") -> StreamManager | None:
    return _stream_managers.get(camera_id)


def get_pipeline(camera_id: str = "0") -> InferencePipeline | None:
    mgr = get_stream_manager(camera_id)
    return mgr.pipeline if mgr else None


def get_al_engine(camera_id: str = "0") -> ALEngine | None:
    mgr = get_stream_manager(camera_id)
    return mgr.al_engine if mgr else None


def get_metrics_tracker(camera_id: str = "0") -> RealtimeMetricsTracker | None:
    mgr = get_stream_manager(camera_id)
    return mgr.metrics_tracker if mgr else None


def list_stream_managers() -> dict[str, StreamManager]:
    return dict(_stream_managers)


async def get_or_create_stream_manager(camera_id: str) -> StreamManager:
    """카메라 ID에 해당하는 StreamManager 반환. 없으면 새로 생성."""
    if camera_id not in _stream_managers:
        gate = registry.active_gate
        clf = registry.active_classifier

        sm = SequenceStateMachine(
            num_targets=settings.num_targets,
            on_target_detected=lambda tid, state: logger.info(
                "Target detected", camera_id=camera_id, target_id=tid, new_state=state
            ),
            on_complete=lambda: logger.info("Sequence COMPLETE", camera_id=camera_id),
            on_violation=lambda tid, state, reason: logger.warning(
                "Sequence violation", camera_id=camera_id, tid=tid, state=state, reason=reason
            ),
        )
        pipeline = InferencePipeline(gate=gate, classifier=clf, state_machine=sm)
        metrics_tracker = RealtimeMetricsTracker(window_size=settings.metrics_window_size)
        al_engine = ALEngine()

        mgr = StreamManager(
            pipeline=pipeline,
            metrics_tracker=metrics_tracker,
            al_engine=al_engine,
            camera_id=camera_id,
        )
        _stream_managers[camera_id] = mgr

        # 메트릭 브로드캐스트 태스크 시작
        task = asyncio.create_task(
            mgr.metrics_broadcast_loop(interval_s=1.0),
            name=f"metrics_broadcast_{camera_id}",
        )
        _metrics_broadcast_tasks[camera_id] = task
        logger.info("StreamManager created", camera_id=camera_id)

    return _stream_managers[camera_id]


async def remove_stream_manager(camera_id: str) -> None:
    """StreamManager 종료 및 제거"""
    if camera_id in _stream_managers:
        await _stream_managers[camera_id].stop()
        del _stream_managers[camera_id]
    if camera_id in _metrics_broadcast_tasks:
        _metrics_broadcast_tasks[camera_id].cancel()
        del _metrics_broadcast_tasks[camera_id]
    logger.info("StreamManager removed", camera_id=camera_id)


async def reinit_pipeline(camera_id: str | None = None) -> None:
    """모델 교체 후 파이프라인 재초기화. camera_id=None이면 전체 재초기화."""
    gate = registry.active_gate
    clf = registry.active_classifier

    targets = [camera_id] if camera_id else list(_stream_managers.keys())
    for cid in targets:
        if cid in _stream_managers:
            mgr = _stream_managers[cid]
            await mgr.pipeline.swap_gate(gate)
            await mgr.pipeline.swap_classifier(clf)

    logger.info("Pipeline reinitialized", cameras=targets)


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 / 종료 시 리소스 관리"""
    # 영상 파일 업로드 크기 제한 해제 (기본 1MB → 무제한)
    from starlette.formparsers import MultiPartParser
    MultiPartParser.max_file_size = float("inf")

    logger.info("Canon Project API starting up")
    settings.ensure_dirs()

    # 기본 모델 생성
    gate = registry.create_gate(settings.gate_model)
    clf = registry.create_classifier(backbone=settings.classifier_backbone)
    registry.register_gate("gate_a", gate)
    registry.register_classifier("classifier", clf)

    # 저장된 모델 자동 로드 (학습 이력 복원)
    _MODEL_DIR = Path("artifacts/models")
    gate_path = _MODEL_DIR / "gate_a.pkl"
    clf_path = _MODEL_DIR / "classifier.pth"
    if gate_path.exists():
        try:
            gate.load(gate_path)
            logger.info("Gate model restored from disk", path=str(gate_path))
        except Exception as e:
            logger.warning("Gate model load failed — starting untrained", error=str(e))
    if clf_path.exists():
        try:
            clf.load(clf_path)
            logger.info("Classifier restored from disk", path=str(clf_path))
        except Exception as e:
            logger.warning("Classifier load failed — starting untrained", error=str(e))

    # 기본 카메라 "0" 미리 생성 (시작은 API 호출로)
    await get_or_create_stream_manager("0")

    logger.info("Canon Project API ready", host=settings.host, port=settings.port)

    yield  # ← 여기서 앱이 실행됨

    # 종료 정리
    logger.info("Shutting down")
    for task in _metrics_broadcast_tasks.values():
        task.cancel()
    # 학습 태스크 취소 (진행 중이면 안전하게 중단)
    from backend.api.routes.training import _training_task, _training_state
    if _training_task and not _training_task.done():
        logger.warning("Training task cancelled due to server shutdown")
        _training_task.cancel()
        _training_state.update({"status": "error", "message": "서버 종료로 학습이 중단되었습니다"})
    for mgr in _stream_managers.values():
        await mgr.stop()


# ── FastAPI 앱 ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Canon Project API",
    description="실시간 Target 이미지 검출 시스템",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
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
    stream_statuses = {cid: mgr._running for cid, mgr in _stream_managers.items()}
    any_active = any(stream_statuses.values())
    return {
        "status": "ok" if (any_active or not _stream_managers) else "degraded",
        "stream_running": stream_statuses,
        "pipeline": len(_stream_managers) > 0,
        "cameras": list(_stream_managers.keys()),
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
        content={
            "error": exc.message,
            "detail": exc.detail,
            "hint": exc.hint,
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request, exc: Exception):
    logger.error("Unhandled error", error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "서버 내부 오류가 발생했습니다",
            "detail": str(exc),
            "hint": "잠시 후 다시 시도하거나, 서버 로그를 확인하세요.",
        },
    )


# ── WebSocket 엔드포인트 ──────────────────────────────────────────────────

@app.websocket("/ws/stream/{camera_id}")
async def ws_stream_camera(websocket: WebSocket, camera_id: str):
    """카메라별 실시간 추론 결과 스트림"""
    channel = f"stream_{camera_id}"
    await ws_manager.connect(websocket, channel)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(websocket, channel)


@app.websocket("/ws/stream")
async def ws_stream_default(websocket: WebSocket):
    """기본 카메라(0) 스트림 (하위 호환)"""
    channel = "stream_0"
    await ws_manager.connect(websocket, channel)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(websocket, channel)


@app.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket):
    """전체 카메라 알림 스트림"""
    await ws_manager.connect(websocket, "alerts")
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(websocket, "alerts")


@app.websocket("/ws/metrics")
async def ws_metrics(websocket: WebSocket):
    """실시간 메트릭 스트림"""
    await ws_manager.connect(websocket, "metrics")
    try:
        mgr = get_stream_manager("0")
        if mgr:
            import json
            await websocket.send_text(
                json.dumps(mgr.metrics_tracker.current_metrics.to_dict(), default=str)
            )
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(websocket, "metrics")


@app.websocket("/ws/training")
async def ws_training(websocket: WebSocket):
    """학습 진행 상태 실시간 스트림"""
    await ws_manager.connect(websocket, "training")
    try:
        # 현재 학습 상태를 즉시 전송 (페이지 재진입 시 복원)
        from backend.api.routes.training import _training_state
        import json
        await websocket.send_text(json.dumps({
            "event": "state",
            **_training_state,
        }, default=str))
        while True:
            try:
                # 25초 대기 — Railway 프록시 60초 타임아웃 전에 keepalive 전송
                await asyncio.wait_for(websocket.receive_text(), timeout=25.0)
            except asyncio.TimeoutError:
                # 클라이언트 메시지 없어도 서버→클라이언트 ping으로 연결 유지
                await websocket.send_text(json.dumps({"event": "ping"}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(websocket, "training")


@app.websocket("/ws/al")
async def ws_al(websocket: WebSocket):
    """AL 큐 상태 실시간 알림"""
    await ws_manager.connect(websocket, "al")
    try:
        while True:
            data = await websocket.receive_json()
            mgr = get_stream_manager("0")
            if data.get("action") == "label" and mgr and mgr.al_engine:
                sample_id = data.get("sample_id")
                label = data.get("label")
                if sample_id is not None and label is not None:
                    try:
                        mgr.al_engine.queue.label(sample_id, label)
                        await ws_manager.broadcast("al", {
                            "event": "labeled",
                            "sample_id": sample_id,
                            "label": label,
                            "stats": mgr.al_engine.stats,
                        })
                    except Exception as e:
                        await websocket.send_json({"error": str(e)})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
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
