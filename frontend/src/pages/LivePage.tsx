import { useCallback, useState } from 'react'
import { Play, Square, RotateCcw, Radio } from 'lucide-react'
import { useWebSocket } from '../api/wsClient'
import { useInferenceStore, useMetricsStore } from '../store'
import type { InferenceResult, MetricsSnapshot } from '../types'
import SequenceIndicator from '../components/SequenceIndicator/SequenceIndicator'
import MetricsPanel from '../components/MetricsPanel/MetricsPanel'
import { api } from '../api/httpClient'
import { useTheme } from '../hooks/useTheme'

export default function LivePage() {
  const t = useTheme()
  const { lastResult, sequenceState, frameCount, isStreaming, setResult, setStreaming, resetSequence } = useInferenceStore()
  const { current: metrics, updateMetrics } = useMetricsStore()
  const [error, setError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState(0)

  const handleStreamMsg = useCallback((data: unknown) => {
    const result = data as InferenceResult
    if (result.frame_id) setResult(result)
  }, [setResult])

  const handleMetricsMsg = useCallback((data: unknown) => {
    updateMetrics(data as MetricsSnapshot)
  }, [updateMetrics])

  useWebSocket('stream', handleStreamMsg)
  useWebSocket('metrics', handleMetricsMsg)

  const handleStart = async () => {
    try {
      setError(null)
      await api.startCamera(deviceId)
      setStreaming(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '카메라 시작 실패')
    }
  }

  const handleStop = async () => {
    try {
      await api.stopCamera()
      setStreaming(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '중지 실패')
    }
  }

  const gate = lastResult?.gate
  const classify = lastResult?.classify
  const sequence = lastResult?.sequence

  return (
    <div className="h-full flex gap-px" style={{ background: t.colors.border }}>
      {/* Left panel */}
      <div className="flex flex-col gap-px" style={{ width: 240, background: t.colors.border }}>
        {/* Camera control */}
        <div className="p-3" style={{ background: t.colors.bgPanel }}>
          <div style={t.sectionHeader} className="mb-2">카메라 제어</div>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontSize: 11, color: t.colors.textMuted }}>장치</span>
            <input
              type="number"
              value={deviceId}
              onChange={(e) => setDeviceId(Number(e.target.value))}
              style={{ ...t.input, width: 48, textAlign: 'center' }}
              min={0}
            />
          </div>
          <div className="flex gap-1">
            <button
              onClick={isStreaming ? handleStop : handleStart}
              style={isStreaming ? t.btnDanger : t.btnPrimary}
            >
              {isStreaming ? <><Square size={11} /> 중지</> : <><Play size={11} /> 시작</>}
            </button>
            <button onClick={resetSequence} style={t.btnSecondary}>
              <RotateCcw size={11} /> 초기화
            </button>
          </div>
          {error && <p style={{ fontSize: 11, color: t.colors.danger, marginTop: 4 }}>{error}</p>}
        </div>

        {/* Pipeline status */}
        <div className="p-3 flex-1" style={{ background: t.colors.bgPanel }}>
          <div style={t.sectionHeader} className="mb-2">파이프라인</div>
          <div className="space-y-1">
            <StatusRow t={t} label="프레임" value={frameCount.toLocaleString()} />
            <StatusRow t={t} label="Gate"
              value={gate ? `${gate.is_target ? 'TARGET' : 'OOD'} (${gate.normalized_score.toFixed(3)})` : '--'}
              color={gate ? (gate.is_target ? t.colors.success : t.colors.textDim) : undefined}
            />
            <StatusRow t={t} label="분류"
              value={classify ? `T${classify.target_id} (${(classify.confidence * 100).toFixed(1)}%)` : '--'}
              color={classify ? (classify.is_uncertain ? t.colors.warning : t.colors.info) : undefined}
            />
            <StatusRow t={t} label="순서"
              value={sequence ? (sequence.accepted ? '확정' : '불일치') : '--'}
              color={sequence ? (sequence.accepted ? t.colors.success : t.colors.danger) : undefined}
            />
            <div style={t.divider} className="my-1" />
            <StatusRow t={t} label="레이턴시"
              value={lastResult ? `${lastResult.total_latency_ms.toFixed(1)}ms` : '--'}
              mono
            />
          </div>
        </div>

        {/* Connection status */}
        <div className="px-3 py-2" style={{ background: t.colors.bgPanel }}>
          <div className="flex items-center gap-2">
            <Radio size={11} style={{ color: isStreaming ? t.colors.success : t.colors.textDim }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: isStreaming ? t.colors.success : t.colors.textDim }}>
              {isStreaming ? '스트리밍 활성' : '대기'}
            </span>
          </div>
        </div>
      </div>

      {/* Center: sequence + probability */}
      <div className="flex-1 flex flex-col gap-px" style={{ background: t.colors.border }}>
        <div className="p-3" style={{ background: t.colors.bgPanel }}>
          <SequenceIndicator currentState={sequenceState} lastResult={lastResult} />
        </div>

        {classify && (
          <div className="p-3" style={{ background: t.colors.bgPanel }}>
            <div style={t.sectionHeader} className="mb-2">분류 확률 분포</div>
            <div className="space-y-1">
              {classify.probabilities.map((prob, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span style={{ fontSize: 10, color: t.colors.textDim, fontFamily: 'monospace', width: 20, textAlign: 'right' }}>T{i + 1}</span>
                  <div className="flex-1 rounded-sm overflow-hidden" style={{ height: 5, background: t.colors.bgInput }}>
                    <div
                      className="h-full rounded-sm transition-all duration-300"
                      style={{
                        width: `${prob * 100}%`,
                        background: i + 1 === classify.target_id ? t.colors.accent : t.colors.textDim,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textMuted, width: 36, textAlign: 'right' }}>
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fill remaining space */}
        <div className="flex-1" style={{ background: t.colors.bgPanel }} />
      </div>

      {/* Right: metrics */}
      <div style={{ width: 220, background: t.colors.bgPanel }} className="overflow-y-auto">
        <MetricsPanel metrics={metrics} />
      </div>
    </div>
  )
}

function StatusRow({ t, label, value, color, mono }: {
  t: ReturnType<typeof useTheme>
  label: string
  value: string
  color?: string
  mono?: boolean
}) {
  return (
    <div className="flex justify-between items-center" style={{ fontSize: 11 }}>
      <span style={{ color: t.colors.textMuted }}>{label}</span>
      <span style={{ color: color || t.colors.text, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  )
}
