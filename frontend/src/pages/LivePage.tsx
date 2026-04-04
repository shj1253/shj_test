import { useCallback, useState } from 'react'
import { Play, Square, RotateCcw, Radio } from 'lucide-react'
import { useWebSocket } from '../api/wsClient'
import { useInferenceStore, useMetricsStore } from '../store'
import type { InferenceResult, MetricsSnapshot } from '../types'
import SequenceIndicator from '../components/SequenceIndicator/SequenceIndicator'
import MetricsPanel from '../components/MetricsPanel/MetricsPanel'
import { api } from '../api/httpClient'

export default function LivePage() {
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
    <div className="p-5 grid grid-cols-[280px_1fr_280px] gap-4 h-[calc(100vh-44px)]">
      {/* 좌측 패널: 제어 + 상태 */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        {/* 카메라 제어 */}
        <div className="panel p-4">
          <h2 className="panel-header mb-3">카메라 제어</h2>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] text-slate-500">장치 ID</span>
            <input
              type="number"
              value={deviceId}
              onChange={(e) => setDeviceId(Number(e.target.value))}
              className="input w-14 text-center text-xs py-1"
              min={0}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={isStreaming ? handleStop : handleStart}
              className={isStreaming ? 'btn-danger' : 'btn-primary'}
            >
              {isStreaming ? <><Square size={12} /> 중지</> : <><Play size={12} /> 시작</>}
            </button>
            <button onClick={resetSequence} className="btn-secondary">
              <RotateCcw size={12} /> 초기화
            </button>
          </div>
          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        </div>

        {/* 파이프라인 상태 */}
        <div className="panel p-4">
          <h2 className="panel-header mb-3">파이프라인 상태</h2>
          <div className="space-y-2.5">
            <StatusRow label="프레임" value={frameCount.toLocaleString()} />
            <StatusRow
              label="Gate"
              value={gate
                ? `${gate.is_target ? 'TARGET' : 'OOD'} (${gate.normalized_score.toFixed(3)})`
                : '--'}
              status={gate ? (gate.is_target ? 'success' : 'neutral') : undefined}
            />
            <StatusRow
              label="분류"
              value={classify
                ? `T${classify.target_id} (${(classify.confidence * 100).toFixed(1)}%)`
                : '--'}
              status={classify ? (classify.is_uncertain ? 'warning' : 'info') : undefined}
            />
            <StatusRow
              label="순서"
              value={sequence
                ? (sequence.accepted ? '확정' : '불일치')
                : '--'}
              status={sequence ? (sequence.accepted ? 'success' : 'danger') : undefined}
            />
            <div className="divider" />
            <StatusRow
              label="레이턴시"
              value={lastResult ? `${lastResult.total_latency_ms.toFixed(1)}ms` : '--'}
              mono
            />
          </div>
        </div>

        {/* 연결 상태 */}
        <div className="panel px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio size={12} className={isStreaming ? 'text-emerald-400' : 'text-slate-600'} />
            <span className={`text-[11px] font-medium ${isStreaming ? 'text-emerald-400' : 'text-slate-600'}`}>
              {isStreaming ? '스트리밍 활성' : '대기'}
            </span>
            {isStreaming && <span className="pulse-dot bg-emerald-400 ml-auto" />}
          </div>
        </div>
      </div>

      {/* 중앙: 시퀀스 + 확률 */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        <SequenceIndicator
          currentState={sequenceState}
          lastResult={lastResult}
        />

        {/* 분류 확률 분포 */}
        {classify && (
          <div className="panel p-4">
            <h2 className="panel-header mb-3">분류 확률 분포</h2>
            <div className="space-y-1.5">
              {classify.probabilities.map((prob, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 w-6 text-right font-mono">T{i + 1}</span>
                  <div className="flex-1 bg-[#0f172a] rounded-sm h-[6px] overflow-hidden">
                    <div
                      className={`h-full rounded-sm transition-all duration-300 ${
                        i + 1 === classify.target_id ? 'bg-blue-500' : 'bg-slate-700'
                      }`}
                      style={{ width: `${prob * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 w-10 text-right">
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 우측: 메트릭 */}
      <div className="overflow-y-auto">
        <MetricsPanel metrics={metrics} />
      </div>
    </div>
  )
}

function StatusRow({
  label,
  value,
  status,
  mono = false,
}: {
  label: string
  value: string
  status?: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  mono?: boolean
}) {
  const colorMap = {
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-blue-400',
    neutral: 'text-slate-500',
  }
  const valueColor = status ? colorMap[status] : 'text-slate-300'

  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-xs ${mono ? 'font-mono' : ''} ${valueColor}`}>{value}</span>
    </div>
  )
}
