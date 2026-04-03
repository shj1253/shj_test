import { useEffect, useState } from 'react'
import { RotateCcw, CheckCircle, RefreshCw, Zap } from 'lucide-react'
import { api } from '../api/httpClient'
import { useALStore } from '../store'
import type { ALSample } from '../types'

const TARGET_LABELS = ['T1', 'T2', 'T3', 'T4']
const TARGET_COLORS = ['bg-red-600', 'bg-blue-600', 'bg-green-600', 'bg-yellow-600']

export default function LabelReviewPage() {
  const { queue, stats, setQueue, pushLabelAction, undoLast, updateStats } = useALStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [trainLoading, setTrainLoading] = useState(false)

  const fetchQueue = async () => {
    try {
      const res = await api.getALQueue()
      setQueue(res.data.samples as ALSample[])
      updateStats(res.data.stats)
    } catch {
      // silent
    }
  }

  useEffect(() => {
    fetchQueue()
    const interval = setInterval(fetchQueue, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleLabel = async (sampleId: string, label: number) => {
    try {
      setError(null)
      await api.submitLabel(sampleId, label)
      pushLabelAction({ sample_id: sampleId, label, labeled_at: new Date().toISOString() })
      setSuccess(`T${label + 1} 레이블 완료`)
      setTimeout(() => setSuccess(null), 2000)
      await fetchQueue()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '레이블 실패')
    }
  }

  const handleUndo = async () => {
    try {
      setError(null)
      await api.undoLabel()
      undoLast()
      setSuccess('Undo 완료')
      setTimeout(() => setSuccess(null), 2000)
      await fetchQueue()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Undo 실패')
    }
  }

  const handleTrain = async () => {
    setTrainLoading(true)
    setError(null)
    try {
      const res = await api.triggerTraining(10, 1e-4)
      setSuccess(`재학습 완료: Acc ${(res.data.final_metrics.accuracy * 100).toFixed(1)}%`)
      setTimeout(() => setSuccess(null), 5000)
      await fetchQueue()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '재학습 실패')
    } finally {
      setTrainLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Active Learning 레이블링</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            미분류 {stats.unlabeled_count}건 | 완료 {stats.labeled_count}건 | 총 {stats.total_added}건
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
          >
            <RotateCcw size={14} /> Undo
          </button>
          <button
            onClick={fetchQueue}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
          >
            <RefreshCw size={14} /> 새로고침
          </button>
          <button
            onClick={handleTrain}
            disabled={trainLoading || stats.labeled_count === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            <Zap size={14} />
            {trainLoading ? '학습 중...' : '재학습 시작'}
          </button>
        </div>
      </div>

      {/* 알림 */}
      {error && <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-300">{error}</div>}
      {success && <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-2 text-sm text-green-300 flex items-center gap-2"><CheckCircle size={14} />{success}</div>}

      {/* 큐 목록 */}
      {queue.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
          <p className="text-gray-500">레이블링할 샘플이 없습니다</p>
          <p className="text-gray-600 text-sm mt-1">시스템이 실행 중이면 자동으로 수집됩니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {queue.map((sample) => (
            <div key={sample.sample_id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {/* 샘플 정보 */}
              <div className="p-3 border-b border-gray-800">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    sample.queue_type === 'gate_margin'
                      ? 'bg-orange-900 text-orange-300'
                      : 'bg-purple-900 text-purple-300'
                  }`}>
                    {sample.queue_type === 'gate_margin' ? 'Gate마진' : 'Classify불확실'}
                  </span>
                  <span>우선순위 {(sample.priority_score * 100).toFixed(0)}%</span>
                </div>

                {/* 확률 미니 바 */}
                {sample.classify_probs && (
                  <div className="flex gap-0.5 h-1.5 mt-2">
                    {sample.classify_probs.map((p, i) => (
                      <div
                        key={i}
                        className={TARGET_COLORS[i].replace('bg-', 'bg-opacity-80 bg-')}
                        style={{ flex: p }}
                      />
                    ))}
                  </div>
                )}

                <div className="flex gap-2 text-xs text-gray-500 mt-2">
                  <span>Gate: {sample.gate_score.toFixed(3)}</span>
                  {sample.uncertainty_score > 0 && (
                    <span>불확실: {(sample.uncertainty_score * 100).toFixed(0)}%</span>
                  )}
                </div>
              </div>

              {/* 레이블 버튼 */}
              <div className="p-3">
                <p className="text-xs text-gray-500 mb-2">레이블 선택:</p>
                <div className="grid grid-cols-4 gap-1">
                  {TARGET_LABELS.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => handleLabel(sample.sample_id, i)}
                      className={`py-2 rounded text-xs font-bold transition-all hover:scale-105 ${TARGET_COLORS[i]} hover:opacity-90`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
