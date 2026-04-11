import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play, Square, Radio, Plus, X, Video, VideoOff,
  AlertTriangle, Info, CheckCircle2, XCircle, Camera, ChevronDown, ChevronRight,
  WifiOff, RefreshCw, FileVideo, CheckCheck, Filter, Volume2, VolumeX, Wifi, BrainCircuit
} from 'lucide-react'
import { useWebSocket, useWebSocketBinary } from '../api/wsClient'
import { useMetricsStore, useNotifStore, pushApiError } from '../store'
import { api } from '../api/httpClient'
import { useTheme } from '../hooks/useTheme'
import MetricsPanel from '../components/MetricsPanel/MetricsPanel'
import type { DetectionAlert, InferenceResult, MetricsSnapshot, AlertSeverity } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const MAX_ALERTS = 50

// T1~T4 한글 공식 이름 (비전문가 현장 작업자용)
const TARGET_KOREAN: Record<number, string> = {
  1: 'T1 — 초기 설정 화면',
  2: 'T2 — 메뉴 선택 화면',
  3: 'T3 — 파라미터 입력 화면',
  4: 'T4 — 확인/완료 화면',
}

// 시퀀스 상태 → 진행 단계
const SEQ_STEP: Record<string, number> = {
  WAIT_T1: 0, WAIT_T2: 1, WAIT_T3: 2, WAIT_T4: 3, COMPLETE: 4,
}

// 소리 알림 (Web Audio API — 외부 파일 불필요)
function playAlertBeep(severity: AlertSeverity) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    const freq = severity === 'error' ? 920 : severity === 'warning' ? 660 : 440
    osc.frequency.value = freq
    osc.type = severity === 'error' ? 'square' : 'sine'
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (severity === 'error' ? 0.8 : 0.4))
    osc.start()
    osc.stop(ctx.currentTime + (severity === 'error' ? 0.8 : 0.4))
    // 오류는 두 번 울림
    if (severity === 'error') {
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.frequency.value = freq * 1.2
      osc2.type = 'square'
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.5)
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1)
      osc2.start(ctx.currentTime + 0.5)
      osc2.stop(ctx.currentTime + 1.1)
    }
  } catch {
    // 브라우저가 오디오 컨텍스트를 지원하지 않는 경우 무시
  }
}

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

type SeverityFilter = 'all' | AlertSeverity
type SourceMode = 'builtin' | 'external' | 'file'

function severityLabel(s: AlertSeverity) {
  return { error: '오류', warning: '경고', info: '정보', success: '정상' }[s]
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── 단계별 조치사항 ────────────────────────────────────────────────────────

function ActionSteps({ steps, color }: { steps: string[]; color: string }) {
  if (!steps || steps.length === 0) return null
  return (
    <ol className="space-y-0.5 mt-1.5">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span style={{
            fontSize: 9, fontWeight: 800, color, background: color + '25',
            borderRadius: '50%', width: 15, height: 15, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {i + 1}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}>{step}</span>
        </li>
      ))}
    </ol>
  )
}

// ── 알림 카드 ──────────────────────────────────────────────────────────────

function AlertCard({ alert, compact = false, onDismiss, t }: {
  alert: DetectionAlert
  compact?: boolean
  onDismiss?: () => void
  t: ReturnType<typeof useTheme>
}) {
  const [expanded, setExpanded] = useState(!compact)
  const color = SEVERITY_COLOR[alert.severity]
  const Icon = SEVERITY_ICON[alert.severity]
  const isAcknowledged = !!alert.acknowledged

  return (
    <div
      className="rounded overflow-hidden"
      style={{
        border: `1px solid ${color}${isAcknowledged ? '25' : '40'}`,
        background: isAcknowledged ? t.colors.bgInput : color + '0a',
        opacity: isAcknowledged ? 0.65 : 1,
      }}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
        onClick={() => compact && setExpanded(v => !v)}
        style={{ borderBottom: expanded ? `1px solid ${color}25` : 'none' }}
      >
        <Icon size={13} style={{ color: isAcknowledged ? t.colors.textDim : color, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 9, fontWeight: 800, color: isAcknowledged ? t.colors.textDim : color,
                           background: (isAcknowledged ? t.colors.textDim : color) + '20',
                           borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0 }}>
              T{alert.target_id}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.text }} className="truncate">
              {TARGET_KOREAN[alert.target_id] ?? alert.target_name}
            </span>
            {(alert.occurrence_count ?? 0) > 1 && (
              <span style={{ fontSize: 9, background: color + '20', color, borderRadius: 10, padding: '0 5px', fontWeight: 700 }}>
                ×{alert.occurrence_count}
              </span>
            )}
            {isAcknowledged && (
              <CheckCheck size={10} style={{ color: t.colors.success, flexShrink: 0 }} />
            )}
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
        <div className="flex items-center gap-1 flex-shrink-0">
          {onDismiss && (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss() }}
              title="이력에서 삭제"
              style={{ color: t.colors.textDim, padding: 2 }}
              className="hover:text-danger">
              <X size={10} />
            </button>
          )}
          {compact && (
            expanded
              ? <ChevronDown size={11} style={{ color: t.colors.textDim }} />
              : <ChevronRight size={11} style={{ color: t.colors.textDim }} />
          )}
        </div>
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
            {alert.action_steps && alert.action_steps.length > 0 ? (
              <ol className="space-y-1 mt-1.5">
                {alert.action_steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span style={{
                      fontSize: 9, fontWeight: 800, color,
                      background: color + '20', borderRadius: 3,
                      padding: '0 4px', flexShrink: 0, lineHeight: '15px',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 11, color: t.colors.text, lineHeight: 1.5 }}>{step}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p style={{ fontSize: 11, color: t.colors.text, marginTop: 1, fontWeight: 500, lineHeight: 1.5 }}>
                {alert.action}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 토스트 알림 ────────────────────────────────────────────────────────────

function AlertToast({ alert, onDismiss, onAck, t }: {
  alert: DetectionAlert
  onDismiss: () => void
  onAck: () => void
  t: ReturnType<typeof useTheme>
}) {
  const color = SEVERITY_COLOR[alert.severity]
  const Icon = SEVERITY_ICON[alert.severity]
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    const timer = setTimeout(onAck, 30000)
    return () => clearTimeout(timer)
  }, [onAck])

  return (
    <div
      className="rounded shadow-lg overflow-hidden"
      style={{
        width: 340,
        border: `1px solid ${color}60`,
        background: t.colors.bgPanel,
        animation: 'slideIn 0.2s ease-out',
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: color + '20', borderBottom: `1px solid ${color}30` }}>
        <Icon size={14} style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: 11, fontWeight: 800, color,
                           background: color + '20', borderRadius: 3, padding: '1px 6px', fontFamily: 'monospace' }}>
              T{alert.target_id}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color }}>
              [{severityLabel(alert.severity)}]
            </span>
            {(alert.occurrence_count ?? 0) > 1 && (
              <span style={{ fontSize: 9, background: color + '20', color, borderRadius: 10, padding: '0 5px', fontWeight: 700 }}>
                ×{alert.occurrence_count}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.colors.text }} className="truncate">
            {TARGET_KOREAN[alert.target_id] ?? alert.target_name}
          </div>
        </div>
        <button onClick={onAck} style={{ color: t.colors.textDim, flexShrink: 0 }} title="확인 처리">
          <X size={12} />
        </button>
      </div>

      {/* 긴급도 */}
      {alert.urgency && (
        <div className="px-3 py-1" style={{ background: color + '10', borderBottom: `1px solid ${color}20` }}>
          <span style={{ fontSize: 10, fontWeight: 700, color }}>⚡ {alert.urgency}</span>
        </div>
      )}

      {/* 본문 */}
      <div className="px-3 py-2 space-y-1.5">
        <p style={{ fontSize: 11, color: t.colors.textMuted }}>{alert.situation}</p>

        {/* 조치사항 */}
        {alert.action_steps && alert.action_steps.length > 0 ? (
          <>
            <button
              onClick={() => setShowSteps(v => !v)}
              className="flex items-center gap-1"
              style={{ fontSize: 11, fontWeight: 600, color }}>
              {showSteps ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              조치 사항 ({alert.action_steps.length}단계)
            </button>
            {showSteps && (
              <ol className="space-y-1 pl-1">
                {alert.action_steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span style={{
                      fontSize: 9, fontWeight: 800, color,
                      background: color + '20', borderRadius: 3,
                      padding: '0 4px', flexShrink: 0, lineHeight: '15px',
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 11, color: t.colors.text, lineHeight: 1.4 }}>{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p style={{ fontSize: 11, fontWeight: 600, color: t.colors.text }}>→ {alert.action}</p>
        )}
      </div>

      {/* 확인 버튼 */}
      <div className="px-3 pb-2 flex gap-1.5">
        <button
          onClick={onAck}
          className="flex-1 flex items-center justify-center gap-1 rounded py-1"
          style={{ background: color + '20', border: `1px solid ${color}40`, fontSize: 12, fontWeight: 700, color }}>
          <CheckCheck size={12} /> 확인 (조치 완료)
        </button>
      </div>

      {/* 프로그레스 바 */}
      <div style={{ height: 3, background: color + '40' }}>
        <div style={{ height: '100%', background: color, animation: 'shrink 30s linear forwards' }} />
      </div>
    </div>
  )
}

// ── 카메라 셀 ──────────────────────────────────────────────────────────────

function CameraCell({ cameraId, onAlert, soundEnabled, t, sourceMode = 'external' }: {
  cameraId: string
  onAlert: (alert: DetectionAlert) => void
  soundEnabled: boolean
  t: ReturnType<typeof useTheme>
  sourceMode?: SourceMode
}) {
  const { push: pushNotif } = useNotifStore()
  const [lastResult, setLastResult] = useState<InferenceResult | null>(null)
  const [activeAlert, setActiveAlert] = useState<DetectionAlert | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [showFeed, setShowFeed] = useState(true)
  const [error, setError] = useState<{ msg: string; hint?: string; source?: string } | null>(null)
  const [wsOnline, setWsOnline] = useState(false)
  const [wsReconnectIn, setWsReconnectIn] = useState<number | null>(null)
  const [startLoading, setStartLoading] = useState(false)
  const [showCameraGuide, setShowCameraGuide] = useState(false)
  const [guideType, setGuideType] = useState<'select' | 'handycam' | 'phone_install' | 'phone'>('select')
  const [deviceId, setDeviceId] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [detectedDevices, setDetectedDevices] = useState<Array<{ device_id: number; name: string; resolution: string }>>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const filePickRef = useRef<HTMLInputElement>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 소스 모드 변경 시 deviceId 기본값 조정
  useEffect(() => {
    setDeviceId(sourceMode === 'external' ? 1 : 0)
  }, [sourceMode])

  // 가이드 모달 열릴 때 장치 탐지
  useEffect(() => {
    if (!showCameraGuide) return
    setDevicesLoading(true)
    api.detectDevices()
      .then(res => {
        const devs = res.data?.devices ?? []
        setDetectedDevices(devs)
        // 내장(0)을 제외한 첫 번째 외장 장치를 자동 선택
        const external = devs.find((d: { device_id: number }) => d.device_id > 0)
        if (external) setDeviceId(external.device_id)
      })
      .catch(() => setDetectedDevices([]))
      .finally(() => setDevicesLoading(false))
  }, [showCameraGuide])

  // WS 바이너리로 JPEG 프레임 수신 (HTTP 폴링 대체 — 지연 최소화)
  const [snapUrl, setSnapUrl] = useState<string | null>(null)
  const snapBlobRef = useRef<string | null>(null)

  const handleFrame = useCallback((blob: Blob) => {
    if (!isStreaming || !showFeed) return
    const url = URL.createObjectURL(blob)
    setSnapUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    snapBlobRef.current = url
  }, [isStreaming, showFeed])

  useWebSocketBinary(`feed/${cameraId}`, handleFrame)

  // 스트리밍 중지 시 스냅샷 정리
  useEffect(() => {
    if (!isStreaming || !showFeed) {
      setSnapUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    }
  }, [isStreaming, showFeed])

  // C-2 fix: 컴포넌트 언마운트 시 타이머 정리 → 언마운트 후 setState 오류 방지
  useEffect(() => () => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
  }, [])

  const handleMsg = useCallback((data: unknown) => {
    const d = data as any
    if (d.frame_id) {
      setLastResult(d as InferenceResult)
    }
    if (d.event === 'error') {
      setError({ msg: d.message ?? '스트림 오류', hint: d.hint })
    }
    if (d.event === 'stream_ended') {
      setIsStreaming(false)
    }
    if (d.alert) {
      const alert = d.alert as DetectionAlert
      setActiveAlert(alert)
      onAlert(alert)
      if (soundEnabled) playAlertBeep(alert.severity)
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
      alertTimerRef.current = setTimeout(() => setActiveAlert(null), 30000)
    }
  }, [onAlert, soundEnabled])

  useWebSocket(`stream/${cameraId}`, handleMsg, (online, reconnectIn) => {
    setWsOnline(online)
    setWsReconnectIn(online ? null : (reconnectIn ?? null))
    // 재연결 시 스냅샷 폴링이 자동으로 재시작됨 (isStreaming 의존)
  })

  const clearError = () => setError(null)

  const handleStart = async () => {
    if (startLoading) return  // prevent double-click race
    setStartLoading(true)
    try {
      setError(null)
      await api.startCameraById(cameraId, deviceId)
      setIsStreaming(true)

    } catch (err: unknown) {
      const anyErr = err as any
      const msg = anyErr?.response?.data?.error ?? (err instanceof Error ? err.message : '시작 실패')
      const hint = anyErr?.response?.data?.hint
      setError({ msg, hint })
      pushApiError(pushNotif, err, `카메라 ${cameraId} 시작 실패`)
    } finally {
      setStartLoading(false)
    }
  }

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadPct(0)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('loop', 'true')
      await api.uploadAndStartFile(cameraId, form, (pct) => setUploadPct(pct))
      setIsStreaming(true)

    } catch (err: unknown) {
      const anyErr = err as any
      const msg = anyErr?.response?.data?.detail ?? (err instanceof Error ? err.message : '파일 시작 실패')
      setError({ msg, source: 'file' })
      pushApiError(pushNotif, err, `파일 소스 시작 실패`)
    } finally {
      setUploading(false)
      setUploadPct(0)
      if (filePickRef.current) filePickRef.current.value = ''
    }
  }

  const handleStop = async () => {
    try {
      await api.stopCameraById(cameraId)
      setIsStreaming(false)
      setLastResult(null)
      setActiveAlert(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '중지 실패'
      setError({ msg })
    }
  }

  const acknowledgeAlert = () => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
    setActiveAlert(null)
  }

  const gate = lastResult?.gate
  const classify = lastResult?.classify
  const alertColor = activeAlert ? SEVERITY_COLOR[activeAlert.severity] : null
  const AlertIcon = activeAlert ? SEVERITY_ICON[activeAlert.severity] : null

  return (
    <div className="flex flex-col h-full rounded overflow-hidden"
         style={{ border: `2px solid ${activeAlert ? alertColor! : t.colors.border}`, transition: 'border-color 0.3s' }}>
      {/* 카메라 헤더 */}
      <div className="flex items-center gap-1.5 px-2 py-1 flex-shrink-0"
           style={{ background: t.colors.bgPanel, borderBottom: `1px solid ${t.colors.border}` }}>
        <Camera size={11} style={{ color: isStreaming ? t.colors.success : t.colors.textDim }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.text, fontFamily: 'monospace' }}>
          CAM {cameraId}
        </span>
        {/* WS 연결 상태 */}
        <span className="flex items-center gap-0.5"
              title={wsOnline ? '서버 연결됨' : `서버 연결 끊김 — ${wsReconnectIn ?? 3}초 후 재연결`}>
          {wsOnline
            ? <Wifi size={9} style={{ color: t.colors.success }} />
            : <>
                <WifiOff size={9} style={{ color: t.colors.danger }} />
                {wsReconnectIn != null && (
                  <span style={{ fontSize: 8, color: t.colors.danger, fontFamily: 'monospace' }}>{wsReconnectIn}s</span>
                )}
              </>
          }
        </span>
        {/* 모니터링 상태 */}
        {isStreaming
          ? <span style={{ fontSize: 9, color: t.colors.success, fontWeight: 700,
                           background: t.colors.success + '20', borderRadius: 3, padding: '1px 4px' }}>
              ● 감시 중
            </span>
          : <span style={{ fontSize: 9, color: t.colors.textDim, fontWeight: 600 }}>대기</span>
        }
        {activeAlert && (
          <span style={{ fontSize: 9, fontWeight: 700, color: alertColor!,
                         background: alertColor! + '20', borderRadius: 3, padding: '1px 4px' }}>
            ⚠ {severityLabel(activeAlert.severity)}
          </span>
        )}
        <div className="flex gap-0.5 ml-auto">
          {/* 스트리밍 중일 때만 헤더에 중지/파일/피드 버튼 노출. 대기 중 시작은 블랙 박스 중앙 버튼으로 통일 */}
          {isStreaming ? (
            <>
              <button onClick={handleStop}
                      style={{ ...t.btnDanger, padding: '1px 5px', fontSize: 10 }}>
                <Square size={9} /> 중지
              </button>
              <button onClick={() => setShowFeed(v => !v)}
                      title={showFeed ? '피드 숨기기' : '피드 보이기'}
                      style={{ ...t.btnSecondary, padding: '1px 5px', fontSize: 10 }}>
                {showFeed ? <VideoOff size={9} /> : <Video size={9} />}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* hidden file input (파일 모드 idle 상태에서 사용) */}
      <input
        ref={filePickRef}
        type="file"
        accept="video/mp4,video/avi,video/quicktime,video/x-matroska,image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      />

      {/* 에러 배너 */}
      {error && (
        <div className="px-2 py-1.5 flex-shrink-0 space-y-0.5"
             style={{ background: t.colors.danger + '12', borderBottom: `1px solid ${t.colors.danger}30` }}>
          <div className="flex items-center gap-1.5">
            <XCircle size={11} style={{ color: t.colors.danger, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: t.colors.danger, flex: 1 }}>{error.msg}</span>
            <button onClick={clearError} style={{ color: t.colors.textDim }}><X size={10} /></button>
          </div>
          {error.hint && (
            <p style={{ fontSize: 10, color: t.colors.textMuted, paddingLeft: 18, lineHeight: 1.4 }}>
              TIP: {error.hint}
            </p>
          )}
          <button
            onClick={() => {
              clearError()
              if (error.source === 'file') {
                filePickRef.current?.click()
              } else {
                handleStart()
              }
            }}
            disabled={startLoading}
            style={{ ...t.btnSecondary, fontSize: 10, padding: '2px 8px', marginLeft: 18, opacity: startLoading ? 0.6 : 1 }}
          >
            <RefreshCw size={10} /> {error.source === 'file' ? '파일 다시 선택' : (startLoading ? '시작 중...' : '다시 시도')}
          </button>
        </div>
      )}

      {/* 피드 영역 */}
      <div className="flex-1 relative overflow-hidden" style={{ background: '#000', minHeight: 100 }}>
        {isStreaming && showFeed ? (
          snapUrl
            ? <img src={snapUrl} alt={`cam ${cameraId}`}
                   style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            : <div className="flex items-center justify-center h-full" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                프레임 대기 중...
              </div>
        ) : isStreaming ? (
          <div className="flex items-center justify-center h-full" style={{ color: t.colors.textDim }}>
            <div className="text-center space-y-1">
              <Video size={24} style={{ margin: '0 auto', opacity: 0.2 }} />
              <p style={{ fontSize: 10, opacity: 0.4 }}>피드 숨김</p>
            </div>
          </div>
        ) : sourceMode === 'file' ? (
          /* 파일 모드 — 파일 선택 UI */
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-center space-y-4" style={{ maxWidth: 260 }}>
              <FileVideo size={36} style={{ margin: '0 auto', color: 'rgba(255,255,255,0.2)' }} />
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: 0, fontWeight: 600 }}>
                영상 파일을 업로드하세요
              </p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                MP4, AVI, MKV, MOV 지원
              </p>
              <button
                onClick={() => filePickRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto',
                  background: t.colors.accent, color: '#fff',
                  fontSize: 14, fontWeight: 700, padding: '10px 24px',
                  borderRadius: 8, border: 'none',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.7 : 1,
                  boxShadow: `0 0 20px ${t.colors.accent}60`,
                }}>
                <FileVideo size={16} />
                {uploading ? (uploadPct < 100 ? `업로드 중... ${uploadPct}%` : '처리 중...') : '파일 선택'}
              </button>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>CAM {cameraId}</p>
            </div>
          </div>
        ) : (
          /* 내장/외장 모드 — 카메라 시작 UI */
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Camera size={32} style={{ margin: '0 auto', color: 'rgba(255,255,255,0.15)' }} />
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, fontWeight: 600 }}>
                {sourceMode === 'builtin' ? '내장 카메라' : '외장 카메라'}가 꺼져 있습니다
              </p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                {sourceMode === 'builtin' ? '노트북 내장 웹캠으로 감시를 시작합니다' : '아래 버튼을 눌러 감시를 시작하세요'}
              </p>
              <button
                onClick={() => { if (sourceMode === 'builtin') { handleStart() } else { setGuideType('select'); setShowCameraGuide(true) } }}
                disabled={startLoading}
                className="flex items-center gap-2 rounded-lg"
                style={{
                  background: t.colors.success,
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  padding: '10px 24px',
                  border: 'none',
                  cursor: startLoading ? 'not-allowed' : 'pointer',
                  opacity: startLoading ? 0.7 : 1,
                  boxShadow: `0 0 20px ${t.colors.success}60`,
                  margin: '0 auto', display: 'flex',
                }}>
                <Play size={16} /> {startLoading ? '시작 중...' : '감시 시작하기'}
              </button>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>CAM {cameraId}</p>
            </div>
          </div>
        )}

        {/* 추론 오버레이 (좌상단) — 개발자용 기술 지표 */}
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

        {/* 시퀀스 진행 표시 (우상단) — 현장 작업자용 */}
        {isStreaming && (
          <div className="absolute top-1 right-1 rounded px-1.5 py-1"
               style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map(step => {
                const seqState = lastResult?.sequence?.current_state ?? 'WAIT_T1'
                const currentStep = SEQ_STEP[seqState] ?? 0
                const isComplete = seqState === 'COMPLETE'
                const isDone = isComplete || currentStep > step
                const isCurrent = currentStep === step - 1 && !isComplete
                return (
                  <div key={step} className="flex items-center gap-0.5">
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800,
                      background: isComplete ? t.colors.success + 'cc'
                        : isDone ? t.colors.success + '80'
                        : isCurrent ? t.colors.accent + 'cc'
                        : 'rgba(255,255,255,0.12)',
                      border: `1px solid ${isComplete || isDone ? t.colors.success : isCurrent ? t.colors.accent : 'rgba(255,255,255,0.2)'}`,
                      color: isDone || isComplete || isCurrent ? '#fff' : 'rgba(255,255,255,0.4)',
                      boxShadow: isCurrent ? `0 0 6px ${t.colors.accent}80` : 'none',
                    }}>
                      {isDone || isComplete ? '✓' : step}
                    </div>
                    {step < 4 && (
                      <div style={{
                        width: 8, height: 1,
                        background: isDone ? t.colors.success : 'rgba(255,255,255,0.15)',
                      }} />
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{
              fontSize: 8, textAlign: 'center', marginTop: 2, fontWeight: 600,
              color: lastResult?.sequence?.current_state === 'COMPLETE' ? t.colors.success : 'rgba(255,255,255,0.5)',
            }}>
              {lastResult?.sequence?.current_state === 'COMPLETE'
                ? '✓ 검사 완료!'
                : `T${(SEQ_STEP[lastResult?.sequence?.current_state ?? 'WAIT_T1'] ?? 0) + 1} 대기 중`}
            </div>
          </div>
        )}

        {/* 알림 오버레이 (하단) */}
        {activeAlert && (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-2"
               style={{
                 background: `linear-gradient(to top, ${alertColor!}e0, ${alertColor!}99)`,
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
                  {activeAlert.urgency && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
                                   background: 'rgba(0,0,0,0.3)', borderRadius: 3, padding: '0 5px' }}>
                      {activeAlert.urgency}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
                  {activeAlert.situation}
                </p>

                {/* 단계별 조치 (축약) */}
                {activeAlert.action_steps && activeAlert.action_steps.length > 0 ? (
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                    → {activeAlert.action_steps[0]}
                    {activeAlert.action_steps.length > 1 && (
                      <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9 }}>
                        {' '}(외 {activeAlert.action_steps.length - 1}단계)
                      </span>
                    )}
                  </p>
                ) : (
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                    → {activeAlert.action}
                  </p>
                )}
              </div>
              {/* 확인 버튼 */}
              <button
                onClick={acknowledgeAlert}
                className="flex-shrink-0 flex items-center gap-1 rounded px-2 py-1"
                style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
                         fontSize: 10, fontWeight: 700, color: '#fff' }}>
                <CheckCheck size={11} /> 확인
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 카메라 연결 가이드 모달 */}
      {showCameraGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowCameraGuide(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.colors.bgPanel,
              border: `1px solid ${t.colors.border}`,
              borderRadius: 16,
              padding: '28px 32px',
              width: 380,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* 가이드 헤더 */}
            <div className="flex items-center gap-2 mb-4">
              <Camera size={20} style={{ color: t.colors.success }} />
              <h2 style={{ fontSize: 16, fontWeight: 700, color: t.colors.text, margin: 0 }}>
                {guideType === 'select' ? '외장 카메라 연결'
                  : guideType === 'handycam' ? '핸디캠 연결 안내'
                  : guideType === 'phone_install' ? '스마트폰 — 프로그램 설치'
                  : '스마트폰 — 연결 방법'}
              </h2>
            </div>

            {/* ── 기기 선택 화면 ── */}
            {guideType === 'select' && (
              <>
                <p style={{ fontSize: 13, color: t.colors.text, marginBottom: 16 }}>
                  어떤 장치를 연결하시겠습니까?
                </p>
                <div className="space-y-2 mb-6">
                  <button
                    onClick={() => setGuideType('handycam')}
                    className="w-full flex items-center gap-3 rounded-lg"
                    style={{
                      padding: '14px 16px', textAlign: 'left',
                      background: t.colors.bgInput,
                      border: `1px solid ${t.colors.border}`,
                      cursor: 'pointer',
                    }}>
                    <Video size={22} style={{ color: t.colors.accent, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: t.colors.text, margin: 0 }}>핸디캠 / 캠코더</p>
                      <p style={{ fontSize: 11, color: t.colors.textDim, margin: 0 }}>Canon 등 USB-UVC 지원 카메라</p>
                    </div>
                    <ChevronRight size={16} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />
                  </button>
                  <button
                    onClick={() => setGuideType('phone_install')}
                    className="w-full flex items-center gap-3 rounded-lg"
                    style={{
                      padding: '14px 16px', textAlign: 'left',
                      background: t.colors.bgInput,
                      border: `1px solid ${t.colors.border}`,
                      cursor: 'pointer',
                    }}>
                    <Camera size={22} style={{ color: t.colors.accent, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: t.colors.text, margin: 0 }}>스마트폰</p>
                      <p style={{ fontSize: 11, color: t.colors.textDim, margin: 0 }}>Android / iPhone USB 유선 연결</p>
                    </div>
                    <ChevronRight size={16} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />
                  </button>
                </div>
                <button
                  onClick={() => setShowCameraGuide(false)}
                  style={{
                    width: '100%', padding: '10px 0', borderRadius: 8,
                    border: `1px solid ${t.colors.border}`,
                    background: 'transparent', color: t.colors.textDim,
                    fontSize: 13, cursor: 'pointer',
                  }}>
                  취소
                </button>
              </>
            )}

            {/* ── 핸디캠 안내 ── */}
            {guideType === 'handycam' && (
              <>
                <ol className="space-y-3 mb-5">
                  {[
                    { step: '1', text: 'USB 케이블로 핸디캠을 노트북에 연결하세요.' },
                    { step: '2', text: '핸디캠 전원을 켜세요.' },
                    { step: '3', text: 'PC 연결 모드(UVC / 웹캠 모드)로 설정하세요.' },
                    { step: '4', text: 'Windows에서 드라이버 설치 알림이 뜨면 완료될 때까지 기다리세요.' },
                  ].map(({ step, text }) => (
                    <li key={step} className="flex items-start gap-3">
                      <span style={{
                        background: t.colors.success, color: '#fff', borderRadius: '50%',
                        width: 22, height: 22, fontSize: 12, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: 1,
                      }}>{step}</span>
                      <span style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.5 }}>{text}</span>
                    </li>
                  ))}
                </ol>
                <p style={{ fontSize: 11, color: t.colors.textMuted, marginBottom: 12, lineHeight: 1.5, padding: '8px 10px',
                            background: t.colors.bgInput, borderRadius: 6, border: `1px solid ${t.colors.border}` }}>
                  Canon: 메뉴 &gt; 연결 설정 &gt; USB &gt; UVC 모드 선택
                </p>
                {/* 장치 선택 — 자동 탐지 */}
                <div style={{ marginBottom: 16 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <p style={{ fontSize: 12, color: t.colors.textDim, fontWeight: 600, margin: 0 }}>감지된 카메라</p>
                    {devicesLoading && <span style={{ fontSize: 10, color: t.colors.textMuted }}>탐색 중...</span>}
                    <button onClick={() => {
                      setDevicesLoading(true)
                      api.detectDevices()
                        .then(res => { setDetectedDevices(res.data?.devices ?? []) })
                        .catch(() => {})
                        .finally(() => setDevicesLoading(false))
                    }} style={{ fontSize: 10, color: t.colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>
                      <RefreshCw size={10} /> 새로고침
                    </button>
                  </div>
                  {detectedDevices.filter(d => d.device_id > 0).length > 0 ? (
                    <div className="space-y-1">
                      {detectedDevices.filter(d => d.device_id > 0).map(dev => (
                        <button key={dev.device_id} onClick={() => setDeviceId(dev.device_id)}
                          className="w-full flex items-center gap-2 rounded-lg"
                          style={{
                            padding: '8px 12px', textAlign: 'left',
                            border: `1px solid ${deviceId === dev.device_id ? t.colors.success : t.colors.border}`,
                            background: deviceId === dev.device_id ? t.colors.success + '15' : 'transparent',
                            cursor: 'pointer',
                          }}>
                          <Camera size={14} style={{ color: deviceId === dev.device_id ? t.colors.success : t.colors.textDim, flexShrink: 0 }} />
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 600, color: deviceId === dev.device_id ? t.colors.success : t.colors.text, margin: 0 }}>
                              {dev.name}
                            </p>
                            <p style={{ fontSize: 10, color: t.colors.textMuted, margin: 0 }}>
                              장치 {dev.device_id} / {dev.resolution}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : !devicesLoading ? (
                    <p style={{ fontSize: 11, color: t.colors.textMuted, padding: '8px 0' }}>
                      외장 카메라가 감지되지 않았습니다. 연결 후 새로고침하세요.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setGuideType('select')} style={{
                    flex: 1, padding: '10px 0', borderRadius: 8,
                    border: `1px solid ${t.colors.border}`, background: 'transparent',
                    color: t.colors.textDim, fontSize: 13, cursor: 'pointer',
                  }}>뒤로</button>
                  <button onClick={() => { setShowCameraGuide(false); handleStart() }}
                    disabled={detectedDevices.filter(d => d.device_id > 0).length === 0}
                    style={{
                    flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                    background: t.colors.success, color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', boxShadow: `0 0 16px ${t.colors.success}50`,
                    opacity: detectedDevices.filter(d => d.device_id > 0).length === 0 ? 0.5 : 1,
                  }}>연결 시작</button>
                </div>
              </>
            )}

            {/* ── 스마트폰: 설치 확인 ── */}
            {guideType === 'phone_install' && (
              <>
                <p style={{ fontSize: 13, color: t.colors.text, marginBottom: 12, lineHeight: 1.6 }}>
                  스마트폰을 웹캠으로 사용하려면 폰과 PC 양쪽에 프로그램 설치가 필요합니다.
                </p>

                <div style={{
                  padding: '14px 16px', borderRadius: 8, marginBottom: 12,
                  background: t.colors.bgInput, border: `1px solid ${t.colors.border}`,
                }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: t.colors.text, margin: '0 0 8px 0' }}>Android</p>
                  <p style={{ fontSize: 12, color: t.colors.textDim, margin: '0 0 4px 0' }}>
                    1. 폰에서 Google Play &gt; <strong style={{ color: t.colors.text }}>DroidCam</strong> 설치
                  </p>
                  <p style={{ fontSize: 12, color: t.colors.textDim, margin: 0 }}>
                    2. PC에서 DroidCam Client 설치:
                  </p>
                  <a href="https://www.dev47apps.com/" target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: 12, color: t.colors.accent, display: 'inline-block', marginTop: 4 }}>
                    dev47apps.com
                  </a>
                </div>

                <div style={{
                  padding: '14px 16px', borderRadius: 8, marginBottom: 20,
                  background: t.colors.bgInput, border: `1px solid ${t.colors.border}`,
                }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: t.colors.text, margin: '0 0 8px 0' }}>iPhone</p>
                  <p style={{ fontSize: 12, color: t.colors.textDim, margin: '0 0 4px 0' }}>
                    1. 폰에서 App Store &gt; <strong style={{ color: t.colors.text }}>EpocCam</strong> 설치
                  </p>
                  <p style={{ fontSize: 12, color: t.colors.textDim, margin: 0 }}>
                    2. PC에서 EpocCam 드라이버 설치:
                  </p>
                  <a href="https://www.elgato.com/s/epoccam" target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: 12, color: t.colors.accent, display: 'inline-block', marginTop: 4 }}>
                    elgato.com/epoccam
                  </a>
                </div>

                <p style={{ fontSize: 12, color: t.colors.text, marginBottom: 16, fontWeight: 600 }}>
                  설치를 완료했으면 다음 단계로 진행하세요.
                </p>

                <div className="flex gap-2">
                  <button onClick={() => setGuideType('select')} style={{
                    flex: 1, padding: '10px 0', borderRadius: 8,
                    border: `1px solid ${t.colors.border}`, background: 'transparent',
                    color: t.colors.textDim, fontSize: 13, cursor: 'pointer',
                  }}>뒤로</button>
                  <button onClick={() => setGuideType('phone')} style={{
                    flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                    background: t.colors.success, color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', boxShadow: `0 0 16px ${t.colors.success}50`,
                  }}>설치 완료, 다음 단계</button>
                </div>
              </>
            )}

            {/* ── 스마트폰: 연결 안내 ── */}
            {guideType === 'phone' && (
              <>
                <ol className="space-y-3 mb-5">
                  {[
                    { step: '1', text: 'USB 케이블로 폰을 노트북에 연결하세요.' },
                    { step: '2', text: '폰에서 DroidCam / EpocCam 앱을 실행하세요.' },
                    { step: '3', text: '앱에서 USB 모드를 선택하세요.' },
                    { step: '4', text: 'PC 클라이언트가 폰 카메라를 인식하면 아래 버튼을 누르세요.' },
                  ].map(({ step, text }) => (
                    <li key={step} className="flex items-start gap-3">
                      <span style={{
                        background: t.colors.accent, color: '#fff', borderRadius: '50%',
                        width: 22, height: 22, fontSize: 12, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: 1,
                      }}>{step}</span>
                      <span style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.5 }}>{text}</span>
                    </li>
                  ))}
                </ol>
                {/* 장치 선택 — 자동 탐지 */}
                <div style={{ marginBottom: 16 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <p style={{ fontSize: 12, color: t.colors.textDim, fontWeight: 600, margin: 0 }}>감지된 카메라</p>
                    {devicesLoading && <span style={{ fontSize: 10, color: t.colors.textMuted }}>탐색 중...</span>}
                    <button onClick={() => {
                      setDevicesLoading(true)
                      api.detectDevices()
                        .then(res => { setDetectedDevices(res.data?.devices ?? []) })
                        .catch(() => {})
                        .finally(() => setDevicesLoading(false))
                    }} style={{ fontSize: 10, color: t.colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>
                      <RefreshCw size={10} /> 새로고침
                    </button>
                  </div>
                  {detectedDevices.filter(d => d.device_id > 0).length > 0 ? (
                    <div className="space-y-1">
                      {detectedDevices.filter(d => d.device_id > 0).map(dev => (
                        <button key={dev.device_id} onClick={() => setDeviceId(dev.device_id)}
                          className="w-full flex items-center gap-2 rounded-lg"
                          style={{
                            padding: '8px 12px', textAlign: 'left',
                            border: `1px solid ${deviceId === dev.device_id ? t.colors.success : t.colors.border}`,
                            background: deviceId === dev.device_id ? t.colors.success + '15' : 'transparent',
                            cursor: 'pointer',
                          }}>
                          <Camera size={14} style={{ color: deviceId === dev.device_id ? t.colors.success : t.colors.textDim, flexShrink: 0 }} />
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 600, color: deviceId === dev.device_id ? t.colors.success : t.colors.text, margin: 0 }}>
                              {dev.name}
                            </p>
                            <p style={{ fontSize: 10, color: t.colors.textMuted, margin: 0 }}>
                              장치 {dev.device_id} / {dev.resolution}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : !devicesLoading ? (
                    <p style={{ fontSize: 11, color: t.colors.textMuted, padding: '8px 0' }}>
                      외장 카메라가 감지되지 않았습니다. 연결 후 새로고침하세요.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setGuideType('phone_install')} style={{
                    flex: 1, padding: '10px 0', borderRadius: 8,
                    border: `1px solid ${t.colors.border}`, background: 'transparent',
                    color: t.colors.textDim, fontSize: 13, cursor: 'pointer',
                  }}>뒤로</button>
                  <button onClick={() => { setShowCameraGuide(false); handleStart() }}
                    disabled={detectedDevices.filter(d => d.device_id > 0).length === 0}
                    style={{
                    flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                    background: t.colors.success, color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', boxShadow: `0 0 16px ${t.colors.success}50`,
                    opacity: detectedDevices.filter(d => d.device_id > 0).length === 0 ? 0.5 : 1,
                  }}>연결 시작</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 전역 알림 배너 (상단) ─────────────────────────────────────────────────

function AppNotifBanner({ t }: { t: ReturnType<typeof useTheme> }) {
  const { notifications, dismiss } = useNotifStore()
  if (notifications.length === 0) return null
  const latest = notifications[notifications.length - 1]
  const color = latest.level === 'error' ? t.colors.danger
    : latest.level === 'warning' ? '#f59e0b'
    : latest.level === 'success' ? t.colors.success
    : t.colors.accent

  return (
    <div className="flex items-start gap-2 px-3 py-2 flex-shrink-0"
         style={{ background: color + '12', borderBottom: `1px solid ${color}30` }}>
      <XCircle size={13} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div className="flex-1 min-w-0">
        <span style={{ fontSize: 11, color: t.colors.text }}>{latest.message}</span>
        {latest.hint && (
          <p style={{ fontSize: 10, color: t.colors.textDim, marginTop: 1 }}>TIP: {latest.hint}</p>
        )}
      </div>
      {latest.retryFn && (
        <button onClick={latest.retryFn}
                style={{ ...t.btnSecondary, fontSize: 10, padding: '1px 6px', flexShrink: 0 }}>
          <RefreshCw size={10} /> 재시도
        </button>
      )}
      <button onClick={() => dismiss(latest.id)} style={{ color: t.colors.textDim, flexShrink: 0 }}>
        <X size={12} />
      </button>
    </div>
  )
}

// ── 메인 LivePage ──────────────────────────────────────────────────────────

export default function LivePage() {
  const t = useTheme()
  const { current: metrics, updateMetrics } = useMetricsStore()

  const [sourceMode, setSourceMode] = useState<SourceMode>('external')
  const [cameras, setCameras] = useState<string[]>(['0'])
  const [newCamId, setNewCamId] = useState('')
  const [alerts, setAlerts] = useState<DetectionAlert[]>([])
  const [toasts, setToasts] = useState<Array<DetectionAlert & { toastId: number }>>([])
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [pipelineModel, setPipelineModel] = useState<{ gate?: string; classifier?: string } | null>(null)
  const [alQueueSize, setAlQueueSize] = useState<number | null>(null)
  const [alTriggering, setAlTriggering] = useState(false)

  const toastSeq = useRef(0)

  // 파이프라인 상태 (로드된 모델명)
  useEffect(() => {
    api.pipelineStatus().then(res => {
      const d = res.data
      if (d) setPipelineModel({ gate: d.gate_model, classifier: d.classifier_model })
    }).catch(() => {})
  }, [])

  // AL 큐 크기 주기적 갱신 (10초마다)
  useEffect(() => {
    const fetch = () => {
      api.alStats().then(res => {
        setAlQueueSize(res.data?.unlabeled_count ?? 0)
      }).catch(() => {})
    }
    fetch()
    const iv = setInterval(fetch, 10000)
    return () => clearInterval(iv)
  }, [])

  // 전체 알림 WS 구독
  useWebSocket('alerts', useCallback((data: unknown) => {
    const d = data as any
    if (d.event === 'alert') {
      const alert = d as DetectionAlert
      setAlerts(prev => [alert, ...prev].slice(0, MAX_ALERTS))
      const id = ++toastSeq.current
      setToasts(prev => [...prev, { ...alert, toastId: id }])
      if (soundEnabled) playAlertBeep(alert.severity)
    }
  }, [soundEnabled]))

  // 메트릭 구독
  useWebSocket('metrics', useCallback((data: unknown) => {
    updateMetrics(data as MetricsSnapshot)
  }, [updateMetrics]))

  const handleAlert = useCallback((_alert: DetectionAlert) => {}, [])

  const dismissToast = useCallback((toastId: number) => {
    setToasts(prev => prev.filter(t => t.toastId !== toastId))
  }, [])

  const ackToast = useCallback((toastId: number) => {
    const toast = toasts.find(t => t.toastId === toastId)
    setToasts(prev => prev.filter(t => t.toastId !== toastId))
    if (toast) {
      // IMP-1 fix: camera_id + timestamp 조합으로 교차 카메라 오인식 방지
      setAlerts(prev => prev.map(a =>
        a.camera_id === toast.camera_id && a.timestamp === toast.timestamp
          ? { ...a, acknowledged: true }
          : a
      ))
    }
  }, [toasts])

  const dismissAlert = useCallback((cameraId: string, timestamp: string) => {
    setAlerts(prev => prev.filter(a => !(a.camera_id === cameraId && a.timestamp === timestamp)))
  }, [])

  const acknowledgeAllAlerts = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })))
    setToasts([])
  }, [])

  const handleModeChange = (mode: SourceMode) => {
    cameras.forEach(id => api.removeCameraById(id).catch(() => {}))
    setSourceMode(mode)
    setCameras(['0'])
    setNewCamId('')
  }

  const addCamera = () => {
    if (sourceMode !== 'external') return
    const id = newCamId.trim()
    if (!id || cameras.includes(id)) return
    setCameras(prev => [...prev, id])
    setNewCamId('')
  }

  const removeCamera = (id: string) => {
    setCameras(prev => prev.filter(c => c !== id))
    api.removeCameraById(id).catch(() => {})
  }

  const gridCols = cameras.length === 1 ? 1 : cameras.length <= 2 ? 2 : cameras.length <= 4 ? 2 : 3
  const gridRows = Math.ceil(cameras.length / gridCols)

  const filteredAlerts = severityFilter === 'all'
    ? alerts
    : alerts.filter(a => a.severity === severityFilter)

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length

  return (
    <>
      {/* 토스트 (우상단) */}
      <div className="fixed top-10 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.toastId} className="pointer-events-auto">
            <AlertToast
              alert={toast}
              onDismiss={() => dismissToast(toast.toastId)}
              onAck={() => ackToast(toast.toastId)}
              t={t}
            />
          </div>
        ))}
      </div>

      <div className="h-full flex flex-col">
        {/* 시스템 상태 헤더 */}
        <div className="flex items-center gap-3 px-3 py-1 flex-shrink-0"
             style={{ background: t.colors.bgPanel, borderBottom: `1px solid ${t.colors.border}`, minHeight: 30 }}>
          <span style={{ fontSize: 10, color: t.colors.textDim }}>파이프라인 모델:</span>
          {pipelineModel ? (
            <>
              <span style={{ fontSize: 10, fontWeight: 600, color: t.colors.accent, fontFamily: 'monospace' }}>
                Gate: {pipelineModel.gate ?? '미로드'}
              </span>
              <span style={{ fontSize: 10, color: t.colors.textDim }}>|</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: t.colors.accent, fontFamily: 'monospace' }}>
                Cls: {pipelineModel.classifier ?? '미로드'}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 10, color: t.colors.textDim }}>로드 중...</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(v => !v)}
              title={soundEnabled ? '소리 끄기' : '소리 켜기'}
              className="flex items-center gap-1 rounded px-2 py-0.5"
              style={{
                fontSize: 10, color: soundEnabled ? t.colors.success : t.colors.textDim,
                background: soundEnabled ? t.colors.success + '15' : 'transparent',
                border: `1px solid ${soundEnabled ? t.colors.success + '40' : t.colors.border}`,
              }}>
              {soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {soundEnabled ? '소리 켜짐' : '소리 꺼짐'}
            </button>
          </div>
        </div>

        {/* 전역 에러 배너 */}
        <AppNotifBanner t={t} />

        {/* 소스 모드 탭 */}
        <div className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0"
             style={{ background: t.colors.bgPanel, borderBottom: `1px solid ${t.colors.border}` }}>
          <span style={{ fontSize: 10, color: t.colors.textDim, marginRight: 4 }}>소스 모드</span>
          {([
            { mode: 'builtin' as SourceMode, label: '내장 카메라' },
            { mode: 'external' as SourceMode, label: '외장 카메라' },
            { mode: 'file' as SourceMode, label: '파일 재생' },
          ]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 14px', borderRadius: 6, fontSize: 12,
                fontWeight: sourceMode === mode ? 700 : 400,
                background: sourceMode === mode ? t.colors.accent + '25' : 'transparent',
                color: sourceMode === mode ? t.colors.accent : t.colors.textDim,
                border: `1px solid ${sourceMode === mode ? t.colors.accent + '60' : t.colors.border}`,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex gap-px overflow-hidden" style={{ background: t.colors.border }}>
          {/* ── 좌측: 카메라 관리 ── */}
          <div className="flex flex-col gap-px flex-shrink-0" style={{ width: 180 }}>
            <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ background: t.colors.bgPanel }}>
              <div style={t.sectionHeader} className="mb-2">카메라</div>
              {cameras.map(id => (
                <div key={id} className="flex items-center gap-1.5 rounded px-2 py-1"
                     style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
                  <Camera size={11} style={{ color: t.colors.accent }} />
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.colors.text, flex: 1 }}>
                    CAM {id}
                  </span>
                  {sourceMode === 'external' && cameras.length > 1 && (
                    <button onClick={() => removeCamera(id)} style={{ color: t.colors.textDim }}>
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
              {sourceMode === 'external' && (
                <div className="flex gap-1 mt-2">
                  <input
                    value={newCamId}
                    onChange={e => setNewCamId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCamera()}
                    placeholder="장치 ID (0,1,2...)"
                    style={{ ...t.input, flex: 1, fontSize: 10 }}
                  />
                  <button onClick={addCamera} style={t.btnPrimary}><Plus size={11} /></button>
                </div>
              )}
            </div>

            {/* AL 빠른 트리거 */}
            <div className="px-2 py-1.5 flex-shrink-0" style={{ background: t.colors.bgPanel, borderTop: `1px solid ${t.colors.border}` }}>
              <div className="flex items-center justify-between mb-1">
                <span style={t.sectionHeader}>능동학습</span>
                {alQueueSize != null && alQueueSize > 0 && (
                  <span style={{ ...t.badge('warning'), fontSize: 9, padding: '0 4px' }}>
                    {alQueueSize}건 대기
                  </span>
                )}
              </div>
              <button
                onClick={async () => {
                  if (alTriggering) return
                  setAlTriggering(true)
                  try { await api.triggerTraining() } catch { /* 무시 */ }
                  finally { setAlTriggering(false) }
                }}
                disabled={alTriggering || !alQueueSize}
                style={{
                  ...t.btnPrimary,
                  width: '100%', fontSize: 10, justifyContent: 'center',
                  opacity: alTriggering || !alQueueSize ? 0.5 : 1,
                  cursor: alTriggering || !alQueueSize ? 'not-allowed' : 'pointer',
                }}>
                <BrainCircuit size={10} />
                {alTriggering ? 'AL 학습 중...' : 'AL 학습 트리거'}
              </button>
            </div>

            {/* 최근 알림 요약 */}
            <div className="px-2 py-1.5 flex-shrink-0" style={{ background: t.colors.bgPanel }}>
              <div className="flex items-center gap-1 mb-1">
                <span style={t.sectionHeader}>알림</span>
                {unacknowledgedCount > 0 && (
                  <span style={{ ...t.badge('danger'), fontSize: 9, padding: '0 4px' }}>
                    {unacknowledgedCount}
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
                           style={{ background: color + '10', border: `1px solid ${color}25`,
                                    opacity: a.acknowledged ? 0.5 : 1 }}>
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
              <CameraCell key={id} cameraId={id} onAlert={handleAlert} soundEnabled={soundEnabled} t={t} sourceMode={sourceMode} />
            ))}
          </div>

          {/* ── 우측: 알림 이력 + 메트릭 ── */}
          <div className="flex flex-col gap-px flex-shrink-0" style={{ width: 310 }}>
            {/* 알림 이력 헤더 */}
            <div className="flex-1 overflow-hidden flex flex-col" style={{ background: t.colors.bgPanel }}>
              <div className="flex items-center justify-between px-2 py-1.5 flex-shrink-0"
                   style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                <div className="flex items-center gap-1.5">
                  <span style={t.sectionHeader}>에러 화면 기록</span>
                  {unacknowledgedCount > 0 && (
                    <span style={{ ...t.badge('danger'), fontSize: 9, padding: '0 4px' }}>
                      {unacknowledgedCount}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {unacknowledgedCount > 0 && (
                    <button onClick={acknowledgeAllAlerts} title="모두 확인"
                            style={{ fontSize: 9, color: t.colors.success, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <CheckCheck size={10} /> 모두확인
                    </button>
                  )}
                  {alerts.length > 0 && (
                    <button onClick={() => setAlerts([])}
                            style={{ fontSize: 9, color: t.colors.textDim }}>
                      초기화
                    </button>
                  )}
                </div>
              </div>

              {/* 필터 탭 */}
              <div className="flex gap-0.5 px-2 py-1 flex-shrink-0"
                   style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                <Filter size={10} style={{ color: t.colors.textDim, marginRight: 2, alignSelf: 'center' }} />
                {(['all', 'error', 'warning', 'info', 'success'] as SeverityFilter[]).map(f => {
                  const count = f === 'all' ? alerts.length : alerts.filter(a => a.severity === f).length
                  if (f !== 'all' && count === 0) return null
                  return (
                    <button
                      key={f}
                      onClick={() => setSeverityFilter(f)}
                      style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        fontWeight: severityFilter === f ? 700 : 400,
                        background: severityFilter === f
                          ? (f === 'all' ? t.colors.accent : SEVERITY_COLOR[f as AlertSeverity]) + '25'
                          : 'transparent',
                        color: severityFilter === f
                          ? (f === 'all' ? t.colors.accent : SEVERITY_COLOR[f as AlertSeverity])
                          : t.colors.textDim,
                        border: `1px solid ${severityFilter === f
                          ? (f === 'all' ? t.colors.accent : SEVERITY_COLOR[f as AlertSeverity]) + '50'
                          : 'transparent'}`,
                      }}>
                      {f === 'all' ? '전체' : severityLabel(f as AlertSeverity)} {count > 0 ? count : ''}
                    </button>
                  )
                })}
              </div>

              {/* 알림 목록 */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2" style={{ color: t.colors.textDim }}>
                    <Radio size={20} style={{ opacity: 0.2 }} />
                    <p style={{ fontSize: 11, opacity: 0.5, fontWeight: 600 }}>
                      {severityFilter === 'all' ? '이상 없음 — 정상 작동 중' : `"${severityLabel(severityFilter as AlertSeverity)}" 없음`}
                    </p>
                    {severityFilter === 'all' && (
                      <p style={{ fontSize: 10, opacity: 0.35, textAlign: 'center', lineHeight: 1.5 }}>
                        Target 화면이 감지되면<br/>여기에 기록됩니다
                      </p>
                    )}
                  </div>
                ) : (
                  filteredAlerts.map((a, i) => (
                    <AlertCard
                      key={`${a.camera_id}_${a.timestamp}_${i}`}
                      alert={a}
                      compact
                      onDismiss={() => dismissAlert(a.camera_id, a.timestamp)}
                      t={t}
                    />
                  ))
                )}
              </div>
            </div>

            {/* 메트릭 */}
            <div className="overflow-y-auto" style={{ background: t.colors.bgPanel, maxHeight: '40%' }}>
              <MetricsPanel metrics={metrics} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </>
  )
}
