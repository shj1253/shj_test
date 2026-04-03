import { useCallback, useState } from 'react'
import { Play, Square, RotateCcw, Wifi } from 'lucide-react'
import { useWebSocket } from '../api/wsClient'
import { useInferenceStore, useMetricsStore } from '../store'
import type { InferenceResult, MetricsSnapshot } from '../types'
import SequenceIndicator from '../components/SequenceIndicator/SequenceIndicator'
import MetricsPanel from '../components/MetricsPanel/MetricsPanel'
import { api } from '../api/httpClient'

const TARGET_NAMES = ['T1', 'T2', 'T3', 'T4']

export default function LivePage() {
  const { lastResult, sequenceState, frameCount, isStreaming, setResult, setStreaming, resetSequence } = useInferenceStore()
  const { current: metrics, updateMetrics } = useMetricsStore()
  const [error, setError] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState(0)

  // WebSocket — 추론 결과
  const handleStreamMsg = useCallback((data: unknown) => {
    const result = data as InferenceResult
    if (result.frame_id) setResult(result)
  }, [setResult])

  // WebSocket — 메트릭
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

  const handleReset = async () => {
    resetSequence()
  }

  const gate = lastResult?.gate
  const classify = lastResult?.classify
  const sequence = lastResult?.sequence

  return (
    <div className="p-6 grid grid-cols-3 gap-6 h-full">
      {/* 왼쪽: 제어 + 상태 */}
      <div className="col-span-1 flex flex-col gap-4">
        {/* 카메라 제어 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">카메라 제어</h2>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-gray-400">장치 ID</label>
            <input
              type="number"
              value={deviceId}
              onChange={(e) => setDeviceId(Number(e.target.value))}
              className="w-16 bg-gray-800 text-sm rounded px-2 py-1 border border-gray-700"
              min={0}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={isStreaming ? handleStop : handleStart}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isStreaming
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isStreaming ? <><Square size={14} /> 중지</> : <><Play size={14} /> 시작</>}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              <RotateCcw size={14} /> 초기화
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* 상태 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">현재 상태</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">프레임</span>
              <span className="font-mono">{frameCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Gate 판정</span>
              {gate ? (
                <span className={gate.is_target ? 'text-green-400' : 'text-gray-500'}>
                  {gate.is_target ? '✓ Target' : '✗ OOD'} ({gate.normalized_score.toFixed(3)})
                </span>
              ) : <span className="text-gray-600">—</span>}
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">분류 결과</span>
              {classify ? (
                <span className={classify.is_uncertain ? 'text-yellow-400' : 'text-blue-400'}>
                  T{classify.target_id} ({(classify.confidence * 100).toFixed(1)}%)
                  {classify.is_uncertain && ' ⚠️'}
                </span>
              ) : <span className="text-gray-600">—</span>}
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">순서</span>
              {sequence ? (
                <span className={sequence.accepted ? 'text-green-400' : 'text-red-400'}>
                  {sequence.accepted ? '✓ 확정' : '✗ 불일치'}
                </span>
              ) : <span className="text-gray-600">—</span>}
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">레이턴시</span>
              <span className="font-mono text-yellow-400">
                {lastResult?.total_latency_ms.toFixed(1) ?? '—'} ms
              </span>
            </div>
          </div>
        </div>

        {/* 연결 상태 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="flex items-center gap-2 text-sm">
            <Wifi size={14} className={isStreaming ? 'text-green-400' : 'text-gray-500'} />
            <span className={isStreaming ? 'text-green-400' : 'text-gray-500'}>
              {isStreaming ? '스트리밍 중' : '대기'}
            </span>
          </div>
        </div>
      </div>

      {/* 가운데: 시퀀스 */}
      <div className="col-span-1 flex flex-col gap-4">
        <SequenceIndicator
          currentState={sequenceState}
          lastResult={lastResult}
        />

        {/* 확률 바 */}
        {classify && (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">분류 확률</h2>
            <div className="space-y-2">
              {classify.probabilities.map((prob, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5">T{i + 1}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${i + 1 === classify.target_id ? 'bg-blue-500' : 'bg-gray-600'}`}
                      style={{ width: `${prob * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-gray-300 w-12 text-right">
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 오른쪽: 메트릭 */}
      <div className="col-span-1">
        <MetricsPanel metrics={metrics} />
      </div>
    </div>
  )
}
