import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play, Square, RotateCcw, Radio, Plus, X, Video, VideoOff,
  AlertTriangle, Info, CheckCircle2, XCircle, Camera, ChevronDown, ChevronRight
} from 'lucide-react'
import { useWebSocket } from '../api/wsClient'
import { useMetricsStore } from '../store'
import { api } from '../api/httpClient'
import { useTheme } from '../hooks/useTheme'
import MetricsPanel from '../components/MetricsPanel/MetricsPanel'
import type { DetectionAlert, InferenceResult, MetricsSnapshot, AlertSeverity } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

// 알림 최대 보관 수
const MAX_ALERTS = 50

// severity별 색상
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  error:   '#ef4444',
  warning: '#f59e0b',
  info:    '#3b82f6',
  success: '#22c55e',
}

const SEVERITY_ICON: Record<AlertSeverity, typeof AlertTriangle> = {
  error:   XCircle,
  warning: AlertTriangle,
  info:    Info,
  success: CheckCircle2,
}

function severityLabel(s: AlertSeverity) {
  return { error: '오류', warning: '경고', info: '정보', success: '정상' }[s]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── 알림 카드 ──────────────────────────────────────────────────────────────

function AlertCard({ alert, compact = false, t }: {
  alert: DetectionAlert
  compact?: boolean
  t: ReturnType<typeof useTheme>
}) {
  const [expanded, setExpanded] = useState(!compact)
  const color = SEVERITY_COLOR[alert.severity]
  const Icon = SEVERITY_ICON[alert.severity]

  return (
    <div
      className="rounded overflow-hidden"
      style={{ border: `1px solid ${color}40`, background: color + '0a' }}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
        onClick={() => compact && setExpanded(v => !v)}
        style={{ borderBottom: expanded ? `1px solid ${color}25` : 'none' }}
      >
        <Icon size={13} style={{ color, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>
              T{alert.target_id}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.text }} className="truncate">
              {alert.target_name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 10, color: t.colors.textDim, fontFamily: 'monospace' }}>
              CAM {alert.camera_id}
            </span>
            <span style={{ fontSize: 10, color: t.colors.textDim }}>
              {formatTime(alert.timestamp)}
            </span>
          </div>
        </div>
        {compact && (
          expanded
            ? <ChevronDown size={11} style={{ color: t.colors.textDim, flexShrink: 0 }} />
            : <ChevronRight size={11} style={{ color: t.colors.textDim, flexShrink: 0 }} />
        )}
      </div>

      {expanded && (
        <div className="px-2 py-2 space-y-1.5">
          <div>
            <span style={{ fontSize: 9, fontWeight: 700, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              감지 화면
            </span>
            <p style={{ fontSize: 11, color: t.colors.text, marginTop: 1 }}>{alert.screen_desc}</p>
          </div>
          <div>
            <span style={{ fontSize: 9, fontWeight: 700, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              현재 상황
            </span>
            <p style={{ fontSize: 11, color: t.colors.textMuted, marginTop: 1, lineHeight: 1.5 }}>{alert.situation}</p>
          </div>
          <div className="rounded px-2 py-1.5" style={{ background: color + '15', border: `1px solid ${color}30` }}>
            <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              조치 사항
            </span>
            <p style={{ fontSize: 11, color: t.colors.text, marginTop: 1, fontWeight: 500, lineHeight: 1.5 }}>{alert.action}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 토스트 알림 ────────────────────────────────────────────────────────────

function AlertToast({ alert, onDismiss, t }: {
  alert: DetectionAlert
  onDismiss: () => void
  t: ReturnType<typeof useTheme>
}) {
  const color = SEVERITY_COLOR[alert.severity]
  const Icon = SEVERITY_ICON[alert.severity]

  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className="rounded shadow-lg overflow-hidden"
      style={{
        width: 320,
        border: `1px solid ${color}60`,
        background: t.colors.bgPanel,
        animation: 'slideIn 0.2s ease-out',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: color + '20', borderBottom: `1px solid ${color}30` }}>
        <Icon size={14} style={{ color }} />
        <span style={{ fontSize: 12, fontWeight: 700, color }}>
          [{severityLabel(alert.severity)}] T{alert.target_id} — {alert.target_name}
        </span>
        <button onClick={onDismiss} className="ml-auto" style={{ color: t.colors.textDim }}>
          <X size={12} />
        </button>
      </div>
      <div className="px-3 py-2 space-y-1">
        <p style={{ fontSize: 11, color: t.colors.textMuted }}>{alert.situation}</p>
        <p style={{ fontSize: 11, fontWeight: 600, color: t.colors.text }}>→ {alert.action}</p>
      </div>
      <div style={{ height: 3, background: color + '40' }}>
        <div style={{ height: '100%', background: color, animation: 'shrink 8s linear forwards' }} />
      </div>
    </div>
  )
}

// ── 카메라 셀 ──────────────────────────────────────────────────────────────

function CameraCell({ cameraId, onAlert, t }: {
  cameraId: string
  onAlert: (alert: DetectionAlert) => void
  t: ReturnType<typeof useTheme>
}) {
  const [lastResult, setLastResult] = useState<InferenceResult | null>(null)
  const [activeAlert, setActiveAlert] = useState<DetectionAlert | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showFeed, setShowFeed] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const feedUrl = `${BASE_URL}/camera/${cameraId}/feed`

  const handleMsg = useCallback((data: unknown) => {
    const d = data as any
    if (d.frame_id) {
      setLastResult(d as InferenceResult)
    }
    if (d.alert) {
      const alert = d.alert as DetectionAlert
      setActiveAlert(alert)
      onAlert(alert)
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      alertTimerRef.current = setTimeout(() => setActiveAlert(null), 10000)
    }
  }, [onAlert])

  useWebSocket(`stream/${cameraId}`, handleMsg)

  const handleStart = async () => {
    try {
      setError(null)
      await api.startCameraById(cameraId, parseInt(cameraId) || 0)
      setIsStreaming(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '시작 실패')
    }
  }

  const handleStop = async () => {
    try {
      await api.stopCameraById(cameraId)
      setIsStreaming(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '중지 실패')
    }
  }

  const gate = lastResult?.gate
  const classify = lastResult?.classify
  const alertColor = activeAlert ? SEVERITY_COLOR[activeAlert.severity] : null
  const AlertIcon = activeAlert ? SEVERITY_ICON[activeAlert.severity] : null

  return (
    <div className="flex flex-col h-full rounded overflow-hidden"
         style={{ border: `1px solid ${alertColor ?? t.colors.border}`, transition: 'border-color 0.3s' }}>
      {/* Camera header */}
      <div className="flex items-center gap-2 px-2 py-1 flex-shrink-0"
           style={{ background: t.colors.bgPanel, borderBottom: `1px solid ${t.colors.border}` }}>
        <Camera size={11} style={{ color: isStreaming ? t.colors.success : t.colors.textDim }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.text, fontFamily: 'monospace' }}>
          CAM {cameraId}
        </span>
        {isStreaming && (
          <span style={{ fontSize: 9, color: t.colors.success, fontWeight: 600 }}>● LIVE</span>
        )}
        {activeAlert && (
          <span style={{ fontSize: 9, fontWeight: 700, color: alertColor! }}>
            {severityLabel(activeAlert.severity).toUpperCase()}
          </span>
        )}
        <div className="flex gap-1 ml-auto">
          <button onClick={isStreaming ? handleStop : handleStart}
                  style={{ ...isStreaming ? t.btnDanger : t.btnPrimary, padding: '1px 6px', fontSize: 10 }}>
            {isStreaming ? <><Square size={9} /> 중지</> : <><Play size={9} /> 시작</>}
          </button>
          <button onClick={() => setShowFeed(v => !v)} style={{ ...t.btnSecondary, padding: '1px 6px', fontSize: 10 }}>
            {showFeed ? <VideoOff size={9} /> : <Video size={9} />}
          </button>
        </div>
      </div>

      {/* Feed area */}
      <div className="flex-1 relative overflow-hidden" style={{ background: '#000', minHeight: 120 }}>
        {isStreaming && showFeed ? (
          <img src={feedUrl} alt={`cam ${cameraId}`}
               style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div className="flex items-center justify-center h-full"
               style={{ color: t.colors.textDim }}>
            <div className="text-center space-y-1">
              <Video size={24} style={{ margin: '0 auto', opacity: 0.2 }} />
              <p style={{ fontSize: 10, opacity: 0.4 }}>
                {isStreaming ? '피드 숨김' : '대기 중'}
              </p>
            </div>
          </div>
        )}

        {/* Inference overlay (top-left) */}
        {lastResult && isStreaming && (
          <div className="absolute top-1 left-1 rounded px-1.5 py-1 space-y-0.5"
               style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
            {gate && (
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>GATE</span>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                               color: gate.is_target ? t.colors.success : t.colors.textDim }}>
                  {gate.is_target ? 'TARGET' : 'OOD'} {gate.normalized_score.toFixed(2)}
                </span>
              </div>
            )}
            {classify && (
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>CLS</span>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: t.colors.accent }}>
                  T{classify.target_id}
                </span>
                <span style={{ fontSize: 9, color: '#aaa', fontFamily: 'monospace' }}>
                  {(classify.confidence * 100).toFixed(1)}%
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>MS</span>
              <span style={{ fontSize: 9, color: '#aaa', fontFamily: 'monospace' }}>
                {lastResult.total_latency_ms.toFixed(0)}ms
              </span>
            </div>
          </div>
        )}

        {/* Alert overlay (bottom) */}
        {activeAlert && (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-2"
               style={{
                 background: `linear-gradient(to top, ${alertColor!}dd, ${alertColor!}99)`,
                 backdropFilter: 'blur(4px)',
                 borderTop: `2px solid ${alertColor!}`,
               }}>
            <div className="flex items-start gap-2">
              {AlertIcon && <AlertIcon size={16} style={{ color: '#fff', flexShrink: 0, marginTop: 1 }} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                    T{activeAlert.target_id}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
                    {activeAlert.target_name}
                  </span>
                </div>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
                  {activeAlert.situation}
                </p>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                  → {activeAlert.action}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-2 py-1 flex-shrink-0" style={{ background: t.colors.danger + '15', fontSize: 10, color: t.colors.danger }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ── 메인 LivePage ──────────────────────────────────────────────────────────

export default function LivePage() {
  const t = useTheme()
  const { current: metrics, updateMetrics } = useMetricsStore()

  const [cameras, setCameras] = useState<string[]>(['0'])
  const [newCamId, setNewCamId] = useState('')
  const [alerts, setAlerts] = useState<DetectionAlert[]>([])
  const [toasts, setToasts] = useState<DetectionAlert[]>([])

  // 전체 알림 WebSocket 구독
  useWebSocket('alerts', useCallback((data: unknown) => {
    const d = data as any
    if (d.event === 'alert') {
      setAlerts(prev => [d as DetectionAlert, ...prev].slice(0, MAX_ALERTS))
      setToasts(prev => [...prev, d as DetectionAlert])
    }
  }, []))

  // 메트릭 구독 (카메라 0 기준)
  useWebSocket('metrics', useCallback((data: unknown) => {
    updateMetrics(data as MetricsSnapshot)
  }, [updateMetrics]))

  const handleAlert = useCallback((alert: DetectionAlert) => {
    // CameraCell에서도 호출됨 — 이미 alerts WS에서 처리하므로 중복 방지 필요 없음
  }, [])

  const dismissToast = useCallback((idx: number) => {
    setToasts(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const addCamera = () => {
    const id = newCamId.trim()
    if (!id || cameras.includes(id)) return
    setCameras(prev => [...prev, id])
    setNewCamId('')
  }

  const removeCamera = (id: string) => {
    setCameras(prev => prev.filter(c => c !== id))
    api.removeCameraById(id).catch(() => {})
  }

  // 카메라 수에 따른 그리드 레이아웃
  const gridCols = cameras.length === 1 ? 1 : cameras.length <= 2 ? 2 : cameras.length <= 4 ? 2 : 3
  const gridRows = Math.ceil(cameras.length / gridCols)

  return (
    <>
      {/* 토스트 알림 (우상단) */}
      <div className="fixed top-10 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((toast, i) => (
          <div key={`${toast.timestamp}_${i}`} className="pointer-events-auto">
            <AlertToast alert={toast} onDismiss={() => dismissToast(i)} t={t} />
          </div>
        ))}
      </div>

      <div className="h-full flex gap-px" style={{ background: t.colors.border }}>
        {/* ── 좌측: 카메라 관리 ── */}
        <div className="flex flex-col gap-px flex-shrink-0" style={{ width: 180 }}>
          {/* 카메라 목록 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ background: t.colors.bgPanel }}>
            <div style={t.sectionHeader} className="mb-2">카메라</div>
            {cameras.map(id => (
              <div key={id} className="flex items-center gap-1.5 rounded px-2 py-1"
                   style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
                <Camera size={11} style={{ color: t.colors.accent }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.colors.text, flex: 1 }}>
                  CAM {id}
                </span>
                {cameras.length > 1 && (
                  <button onClick={() => removeCamera(id)} style={{ color: t.colors.textDim }}>
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}

            {/* 카메라 추가 */}
            <div className="flex gap-1 mt-2">
              <input
                value={newCamId}
                onChange={e => setNewCamId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCamera()}
                placeholder="장치 ID (0,1,2...)"
                style={{ ...t.input, flex: 1, fontSize: 10 }}
              />
              <button onClick={addCamera} style={t.btnPrimary}>
                <Plus size={11} />
              </button>
            </div>
          </div>

          {/* 최근 알림 요약 */}
          <div className="px-2 py-1.5 flex-shrink-0" style={{ background: t.colors.bgPanel }}>
            <div className="flex items-center gap-1 mb-1">
              <span style={t.sectionHeader}>알림</span>
              {alerts.length > 0 && (
                <span style={{
                  ...t.badge('danger'),
                  fontSize: 9,
                  padding: '0 4px',
                }}>
                  {alerts.length}
                </span>
              )}
            </div>
            {alerts.length === 0 ? (
              <p style={{ fontSize: 10, color: t.colors.textDim }}>감지된 알림 없음</p>
            ) : (
              <div className="space-y-1">
                {alerts.slice(0, 3).map((a, i) => {
                  const color = SEVERITY_COLOR[a.severity]
                  const Icon = SEVERITY_ICON[a.severity]
                  return (
                    <div key={i} className="flex items-start gap-1.5 rounded px-1.5 py-1"
                         style={{ background: color + '10', border: `1px solid ${color}25` }}>
                      <Icon size={10} style={{ color, flexShrink: 0, marginTop: 1 }} />
                      <div className="min-w-0">
                        <p style={{ fontSize: 10, fontWeight: 700, color }}>T{a.target_id} CAM{a.camera_id}</p>
                        <p style={{ fontSize: 9, color: t.colors.textDim }} className="truncate">{a.target_name}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 중앙: 카메라 그리드 ── */}
        <div
          className="flex-1 overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, 1fr)`,
            gap: 1,
            background: t.colors.border,
          }}
        >
          {cameras.map(id => (
            <CameraCell key={id} cameraId={id} onAlert={handleAlert} t={t} />
          ))}
        </div>

        {/* ── 우측: 상세 알림 이력 + 메트릭 ── */}
        <div className="flex flex-col gap-px flex-shrink-0" style={{ width: 260 }}>
          {/* 알림 상세 이력 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5" style={{ background: t.colors.bgPanel }}>
            <div className="flex items-center justify-between mb-1">
              <span style={t.sectionHeader}>감지 이력</span>
              {alerts.length > 0 && (
                <button onClick={() => setAlerts([])} style={{ fontSize: 9, color: t.colors.textDim }}>
                  초기화
                </button>
              )}
            </div>
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2"
                   style={{ color: t.colors.textDim }}>
                <Radio size={20} style={{ opacity: 0.2 }} />
                <p style={{ fontSize: 11, opacity: 0.4 }}>감지된 이벤트 없음</p>
              </div>
            ) : (
              alerts.map((a, i) => (
                <AlertCard key={`${a.timestamp}_${i}`} alert={a} compact t={t} />
              ))
            )}
          </div>

          {/* 메트릭 */}
          <div style={{ background: t.colors.bgPanel, maxHeight: 240, overflowY: 'auto' }}>
            <MetricsPanel metrics={metrics} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </>
  )
}
