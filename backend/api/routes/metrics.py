"""
메트릭 API — 실시간 지표 조회 + KPI 리포트
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/metrics", tags=["metrics"])


# ── KPI 정의 ──────────────────────────────────────────────────────────────
# (metric_key, label, target_op, target_val, unit, priority, stage, need_gt)
# priority: 1 = 1st, 2 = 2nd, 0 = 참고
# need_gt: GT 없으면 측정 불가

KPI_DEFINITIONS = [
    # ── Stage 1: 데이터 증강 (오프라인 측정) ──────────────────────────────
    ("coverage_diversity",    "커버리지 다양성",       "gte", 0.90, "",      1, 1, False),
    ("fid_score",             "FID / 도메인 유사도",   "lte", 30.0, "",      1, 1, False),
    ("downstream_f1_gain",    "Downstream 성능 향상률","gte", 0.05, "%",     2, 1, True),

    # ── Stage 2: 이상 탐지 ────────────────────────────────────────────────
    ("ood_recall",            "OOD Recall",            "gte", 0.98, "%",     1, 2, True),
    ("gate_pass_rate",        "통과율 (Pass-through)", "range", (0.10, 0.40), "%", 1, 2, False),
    ("auroc",                 "AUROC (OOD vs In-dist)","gte", 0.95, "",      1, 2, True),
    ("gate_latency_avg_ms",   "처리 지연 (Avg)",       "lte", 10.0, "ms",   1, 2, False),

    # ── Stage 3: 분류 ────────────────────────────────────────────────────
    ("f1",                    "Macro F1",              "gte", 0.95, "%",     1, 3, True),
    ("low_confidence_ratio",  "낮은 신뢰도 비율",      "lte", 0.05, "%",     1, 3, False),
    ("classify_latency_p95_ms","추론 지연 (P95)",      "lte", 50.0, "ms",   2, 3, False),
    ("ece",                   "ECE (신뢰도 보정 오차)","lte", 0.05, "",      1, 3, True),
    # CM 대각 비율은 별도 처리 (배열)

    # ── Stage 4: State Machine ────────────────────────────────────────────
    ("sequence_error_rate",   "순서 오류율",           "lte", 0.01, "%",     1, 4, False),
    ("false_block_rate",      "False Block Rate",      "lte", 0.005,"% ",    1, 4, False),
    ("sequence_completion_rate","시퀀스 완주율",        "gte", 0.99, "%",     2, 4, False),
    ("e2e_latency_ms",        "알림 지연 (E2E)",       "lte", 200.0,"ms",    2, 4, False),
    ("system_precision",      "시스템 수준 정밀도",    "gte", 0.99, "%",     2, 4, False),

    # ── Active Learning ───────────────────────────────────────────────────
    ("al_query_hit_rate",     "쿼리 적중률",           "gte", 0.50, "%",     1, 5, True),
    ("psi_score",             "PSI (드리프트 감지)",   "lte", 0.20, "",      1, 5, False),
]

_PCT_KEYS = {
    "ood_recall", "gate_pass_rate", "f1", "low_confidence_ratio",
    "sequence_error_rate", "false_block_rate", "sequence_completion_rate",
    "system_precision", "auroc", "al_query_hit_rate", "downstream_f1_gain",
}


def _kpi_status(key: str, value: float, op: str, target, need_gt: bool, has_gt: bool) -> str:
    """pass / warn / fail / na"""
    # GT 필요한데 GT 데이터 없으면 N/A
    if need_gt and not has_gt:
        return "na"

    if op == "gte":
        if value >= target:               return "pass"
        if value >= target * 0.9:         return "warn"
        return "fail"
    elif op == "lte":
        if value <= target:               return "pass"
        if value <= target * 1.2:         return "warn"
        return "fail"
    elif op == "range":
        lo, hi = target
        if lo <= value <= hi:             return "pass"
        if lo * 0.8 <= value <= hi * 1.3: return "warn"
        return "fail"
    return "na"


def _fmt(key: str, value: float, unit: str) -> str:
    if key in _PCT_KEYS:
        return f"{value * 100:.1f}%"
    if unit == "ms":
        return f"{value:.1f}ms"
    return f"{value:.3f}"


def _target_str(op: str, target, unit: str) -> str:
    if op == "gte":
        v = target * 100 if unit == "%" else target
        return f"≥ {v:.0f}{unit}"
    elif op == "lte":
        v = target * 100 if unit == "%" else target
        return f"≤ {v:.0f}{unit}"
    elif op == "range":
        lo, hi = target
        lo_v = lo * 100 if unit == "%" else lo
        hi_v = hi * 100 if unit == "%" else hi
        return f"{lo_v:.0f}~{hi_v:.0f}{unit}"
    return ""


def build_kpi_report(snapshot: dict, offline: dict | None = None) -> dict:
    """스냅샷 + 오프라인 측정값으로 KPI 리포트 생성"""
    off = offline or {}

    # 오프라인 값 병합
    merged = {**snapshot, **off}

    # GT 보유 여부: window_size > 0 이고 accuracy > 0 이면 GT 있다고 간주
    has_gt = merged.get("window_size", 0) > 0 and merged.get("accuracy", 0.0) > 0.0

    stages: dict[int, list] = {1: [], 2: [], 3: [], 4: [], 5: []}
    summary = {"total": 0, "pass": 0, "warn": 0, "fail": 0, "na": 0}

    for (key, label, op, target, unit, priority, stage, need_gt) in KPI_DEFINITIONS:
        raw = merged.get(key, 0.0)
        value = float(raw) if raw is not None else 0.0
        status = _kpi_status(key, value, op, target, need_gt, has_gt)

        entry = {
            "key": key,
            "label": label,
            "value": value,
            "display": _fmt(key, value, unit),
            "target": _target_str(op, target, unit),
            "status": status,
            "priority": priority,
            "need_gt": need_gt,
            "unit": unit,
        }
        stages[stage].append(entry)
        summary["total"] += 1
        summary[status] += 1

    # Confusion Matrix 대각 비율 (Stage 3 추가 항목)
    cm_diag = merged.get("cm_diagonal_ratio", [])
    cm_kpi = []
    for i, v in enumerate(cm_diag):
        if has_gt:
            status = "pass" if v >= 0.93 else ("warn" if v >= 0.85 else "fail")
        else:
            status = "na"
        cm_kpi.append({
            "key": f"cm_diag_T{i+1}",
            "label": f"CM 대각 비율 T{i+1}",
            "value": v,
            "display": f"{v * 100:.1f}%",
            "target": "≥ 93%",
            "status": status,
            "priority": 1,
        })
        summary["total"] += 1
        summary[status] += 1

    return {
        "summary": summary,
        "stages": {
            "stage1": stages[1],
            "stage2": stages[2],
            "stage3": stages[3] + cm_kpi,
            "stage4": stages[4],
            "al": stages[5],
        },
    }


# 오프라인 측정값 임시 저장 (서버 재시작 시 초기화)
_offline_metrics: dict = {}


# ── 엔드포인트 ─────────────────────────────────────────────────────────────

@router.get("/summary")
async def metrics_summary():
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr is None:
        raise HTTPException(status_code=503, detail="Not initialized")
    return mgr.metrics_tracker.current_metrics.to_dict()


@router.get("/kpi")
async def kpi_report(camera_id: str = "0"):
    """전 파이프라인 KPI 현황 리포트 (목표치 대비 pass/warn/fail)"""
    from backend.main import get_stream_manager
    mgr = get_stream_manager(camera_id)
    if mgr is None:
        return build_kpi_report({}, _offline_metrics)
    snapshot = mgr.metrics_tracker.current_metrics.to_dict()
    return build_kpi_report(snapshot, _offline_metrics)


@router.post("/kpi/offline")
async def set_offline_metrics(data: dict):
    """오프라인 측정값 등록 (FID, coverage_diversity, downstream_f1_gain 등)"""
    global _offline_metrics
    _offline_metrics.update(data)
    return {"status": "ok", "stored": list(_offline_metrics.keys())}


@router.get("/history")
async def metrics_history(n: int = Query(50, ge=1, le=500)):
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr is None:
        raise HTTPException(status_code=503, detail="Not initialized")
    return {"history": mgr.metrics_tracker.get_history(n), "count": n}


@router.get("/session")
async def session_info():
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr is None:
        raise HTTPException(status_code=503, detail="Not initialized")
    return mgr.metrics_tracker.session_info


@router.post("/reset")
async def reset_metrics():
    from backend.main import list_stream_managers
    for mgr in list_stream_managers().values():
        mgr.metrics_tracker.reset()
    return {"status": "reset"}


@router.get("/pipeline")
async def pipeline_status():
    from backend.main import get_stream_manager
    mgr = get_stream_manager("0")
    if mgr is None:
        return {"initialized": False}
    return {"initialized": True, **mgr.pipeline.get_status()}
