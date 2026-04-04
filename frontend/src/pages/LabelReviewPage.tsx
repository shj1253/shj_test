import { useEffect, useState } from 'react'
import { RotateCcw, CheckCircle2, RefreshCw, Zap } from 'lucide-react'
import { api } from '../api/httpClient'
import { useALStore } from '../store'
import type { ALSample } from '../types'

const BASE_COLORS = [
  'bg-red-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-violet-600', 'bg-cyan-600', 'bg-pink-600', 'bg-lime-600',
  'bg-orange-600', 'bg-teal-600', 'bg-rose-600', 'bg-indigo-600',
  'bg-fuchsia-600', 'bg-sky-600', 'bg-emerald-600', 'bg-yellow-600',
  'bg-purple-600', 'bg-green-600', 'bg-blue-600', 'bg-red-600',
]

function getTargetColor(index: number) {
  return BASE_COLORS[index % BASE_COLORS.length]
}

export default function LabelReviewPage() {
  const { queue, stats, setQueue, pushLabelAction, undoLast, updateStats } = useALStore()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [trainLoading, setTrainLoading] = useState(false)
  const [numTargets, setNumTargets] = useState(4)

  const fetchQueue = async () => {
    try {
      const res = await api.getALQueue()
      setQueue(res.data.samples as ALSample[])
      updateStats(res.data.stats)
      if (res.data.num_targets) setNumTargets(res.data.num_targets)
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

  const targetLabels = Array.from({ length: numTargets }, (_, i) => `T${i + 1}`)

  return (
    <div className="p-5 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-100">Active Learning</h1>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
            미분류 {stats.unlabeled_count} / 완료 {stats.labeled_count} / 총 {stats.total_added}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={handleUndo} className="btn-secondary">
            <RotateCcw size={12} /> Undo
          </button>
          <button onClick={fetchQueue} className="btn-secondary">
            <RefreshCw size={12} /> 새로고침
          </button>
          <button
            onClick={handleTrain}
            disabled={trainLoading || stats.labeled_count === 0}
            className="btn-primary"
          >
            <Zap size={12} />
            {trainLoading ? '학습 중...' : '재학습 시작'}
          </button>
        </div>
      </div>

      {/* 알림 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded px-4 py-2 text-xs text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 size={13} />{success}
        </div>
      )}

      {/* 큐 목록 */}
      {queue.length === 0 ? (
        <div className="panel p-10 text-center">
          <p className="text-slate-500 text-xs">레이블링할 샘플 없음</p>
          <p className="text-slate-600 text-[11px] mt-1">시스템 실행 중 자동 수집됩니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {queue.map((sample) => (
            <div key={sample.sample_id} className="panel overflow-hidden">
              {/* 샘플 정보 */}
              <div className="p-3 border-b border-[#1e293b]">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
                  <span className={`badge ${
                    sample.queue_type === 'gate_margin' ? 'badge-warning' : 'badge-info'
                  }`}>
                    {sample.queue_type === 'gate_margin' ? 'GATE MARGIN' : 'UNCERTAIN'}
                  </span>
                  <span className="font-mono">
                    {(sample.priority_score * 100).toFixed(0)}%
                  </span>
                </div>

                {sample.classify_probs && (
                  <div className="flex gap-px h-1 mt-2 rounded-sm overflow-hidden">
                    {sample.classify_probs.map((p, i) => (
                      <div
                        key={i}
                        className={`${getTargetColor(i)} opacity-70`}
                        style={{ flex: p }}
                      />
                    ))}
                  </div>
                )}

                <div className="flex gap-3 text-[10px] text-slate-600 mt-2 font-mono">
                  <span>gate: {sample.gate_score.toFixed(3)}</span>
                  {sample.uncertainty_score > 0 && (
                    <span>unc: {(sample.uncertainty_score * 100).toFixed(0)}%</span>
                  )}
                </div>
              </div>

              {/* 레이블 버튼 */}
              <div className="p-3">
                <p className="text-[10px] text-slate-600 mb-1.5">레이블 선택</p>
                <div className="grid gap-1" style={{
                  gridTemplateColumns: `repeat(${Math.min(numTargets, 6)}, 1fr)`
                }}>
                  {targetLabels.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => handleLabel(sample.sample_id, i)}
                      className={`py-1.5 rounded text-[10px] font-bold text-white transition-all
                                  hover:opacity-80 active:scale-95 ${getTargetColor(i)}`}
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
