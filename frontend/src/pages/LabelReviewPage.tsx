import { useEffect, useState } from 'react'
import { RotateCcw, CheckCircle2, RefreshCw, Zap } from 'lucide-react'
import { api } from '../api/httpClient'
import { useALStore } from '../store'
import type { ALSample } from '../types'
import { useTheme } from '../hooks/useTheme'

const TARGET_HUES = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#e11d48', '#6366f1',
  '#d946ef', '#0ea5e9', '#22c55e', '#eab308',
  '#a855f7', '#16a34a', '#2563eb', '#dc2626',
]

export default function LabelReviewPage() {
  const t = useTheme()
  const { queue, stats, setQueue, pushLabelAction, undoLast, updateStats } = useALStore()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [trainLoading, setTrainLoading] = useState(false)
  const [numTargets, setNumTargets] = useState(4)
  const [loadError, setLoadError] = useState(false)

  const fetchQueue = async () => {
    try {
      const res = await api.getALQueue()
      setQueue(res.data.samples as ALSample[])
      updateStats(res.data.stats)
      if (res.data.num_targets) setNumTargets(res.data.num_targets)
      setLoadError(false)
    } catch {
      setLoadError(true)
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
      setError(null); await api.undoLabel(); undoLast()
      setSuccess('Undo 완료'); setTimeout(() => setSuccess(null), 2000)
      await fetchQueue()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Undo 실패') }
  }

  const handleTrain = async () => {
    setTrainLoading(true); setError(null)
    try {
      const res = await api.triggerTraining(10, 1e-4)
      setSuccess(`재학습 완료: Acc ${(res.data.final_metrics.accuracy * 100).toFixed(1)}%`)
      setTimeout(() => setSuccess(null), 5000)
      await fetchQueue()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '재학습 실패') }
    finally { setTrainLoading(false) }
  }

  const targetLabels = Array.from({ length: numTargets }, (_, i) => `T${i + 1}`)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="shrink-0 px-4 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${t.colors.border}`, background: t.colors.bgPanel }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, color: t.colors.textHeading }}>Active Learning</span>
          <span style={{ fontSize: 10, color: t.colors.textMuted, marginLeft: 8, fontFamily: 'monospace' }}>
            미분류 {stats.unlabeled_count} / 완료 {stats.labeled_count} / 총 {stats.total_added}
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={handleUndo} style={t.btnSecondary}><RotateCcw size={11} /> Undo</button>
          <button onClick={fetchQueue} style={t.btnSecondary}><RefreshCw size={11} /> 새로고침</button>
          <button onClick={handleTrain} disabled={trainLoading || stats.labeled_count === 0} style={t.btnPrimary}>
            <Zap size={11} />{trainLoading ? '학습 중...' : '재학습'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-2 rounded px-3 py-1.5" style={{ background: t.colors.danger + '15', border: `1px solid ${t.colors.danger}30`, fontSize: 11, color: t.colors.danger }}>
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-2 flex items-center gap-1 rounded px-3 py-1.5" style={{ background: t.colors.success + '15', border: `1px solid ${t.colors.success}30`, fontSize: 11, color: t.colors.success }}>
          <CheckCircle2 size={12} />{success}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadError ? (
          <div className="rounded p-6 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
            <p style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>백엔드 서버에 연결할 수 없습니다</p>
            <p style={{ fontSize: 11, color: t.colors.textDim }}>서버를 시작한 후 새로고침 버튼을 눌러주세요</p>
          </div>
        ) : queue.length === 0 ? (
          <div className="rounded p-6 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
            <p style={{ fontSize: 12, color: t.colors.textMuted }}>레이블링할 샘플이 없습니다</p>
            <p style={{ fontSize: 11, color: t.colors.textDim, marginTop: 4 }}>시스템 실행 중 불확실한 샘플이 자동으로 수집됩니다</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {queue.map((sample) => (
              <div key={sample.sample_id} className="rounded overflow-hidden" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
                <div className="p-2" style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                  <div className="flex items-center justify-between mb-1">
                    <span style={t.badge(sample.queue_type === 'gate_margin' ? 'warning' : 'info')}>
                      {sample.queue_type === 'gate_margin' ? 'GATE MARGIN' : 'UNCERTAIN'}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textDim }}>
                      {(sample.priority_score * 100).toFixed(0)}%
                    </span>
                  </div>

                  {sample.classify_probs && (
                    <div className="flex gap-px h-1 rounded-sm overflow-hidden mt-1.5">
                      {sample.classify_probs.map((p, i) => (
                        <div key={i} style={{ flex: p, background: TARGET_HUES[i % TARGET_HUES.length], opacity: 0.7 }} />
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 mt-1.5" style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textDim }}>
                    <span>gate: {sample.gate_score.toFixed(3)}</span>
                    {sample.uncertainty_score > 0 && <span>unc: {(sample.uncertainty_score * 100).toFixed(0)}%</span>}
                  </div>
                </div>

                <div className="p-2">
                  <div style={{ fontSize: 10, color: t.colors.textDim, marginBottom: 3 }}>레이블 선택</div>
                  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(numTargets, 6)}, 1fr)` }}>
                    {targetLabels.map((label, i) => (
                      <button key={i} onClick={() => handleLabel(sample.sample_id, i)}
                        className="rounded text-white transition-all active:scale-95"
                        style={{
                          padding: '4px 0',
                          fontSize: 10,
                          fontWeight: 700,
                          background: TARGET_HUES[i % TARGET_HUES.length],
                        }}>
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
    </div>
  )
}
