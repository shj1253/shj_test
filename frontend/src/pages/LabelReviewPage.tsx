import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RotateCcw, CheckCircle2, RefreshCw, Zap, SkipForward,
  Keyboard, ChevronDown, ChevronUp, X, History, AlertCircle,
  Settings2, BookOpen, AlertTriangle
} from 'lucide-react'
import { api } from '../api/httpClient'
import { useALStore, useNotifStore, pushApiError, type LabelAction } from '../store'
import type { ALSample } from '../types'
import { useTheme } from '../hooks/useTheme'

const TARGET_HUES = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#e11d48', '#6366f1',
  '#d946ef', '#0ea5e9', '#22c55e', '#eab308',
  '#a855f7', '#16a34a', '#2563eb', '#dc2626',
]

// ── 인라인 토스트 ────────────────────────────────────────────────────────────

function InlineToast({ msg, level, onDismiss }: {
  msg: string
  level: 'success' | 'error' | 'info'
  onDismiss: () => void
}) {
  const t = useTheme()
  const color = level === 'success' ? t.colors.success : level === 'error' ? t.colors.danger : t.colors.accent
  const Icon = level === 'success' ? CheckCircle2 : AlertCircle
  useEffect(() => {
    const timer = setTimeout(onDismiss, level === 'error' ? 6000 : 3000)
    return () => clearTimeout(timer)
  }, [level, onDismiss])
  return (
    <div className="flex items-start gap-2 rounded px-3 py-2"
         style={{ background: color + '15', border: `1px solid ${color}35`, fontSize: 11 }}>
      <Icon size={13} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <span style={{ color: t.colors.text, flex: 1 }}>{msg}</span>
      <button onClick={onDismiss} style={{ color: t.colors.textDim }}><X size={11} /></button>
    </div>
  )
}

// ── Undo 이력 패널 ──────────────────────────────────────────────────────────

function UndoHistoryPanel({ history, onUndoItem, t }: {
  history: LabelAction[]
  onUndoItem: (sampleId: string) => void
  t: ReturnType<typeof useTheme>
}) {
  if (history.length === 0) {
    return (
      <p style={{ fontSize: 10, color: t.colors.textDim, textAlign: 'center', padding: '8px 0' }}>
        레이블 이력 없음
      </p>
    )
  }
  return (
    <div className="space-y-0.5 max-h-48 overflow-y-auto">
      {[...history].reverse().map((action, i) => (
        <div key={`${action.sample_id}_${i}`}
             className="flex items-center gap-1.5 rounded px-2 py-1"
             style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
          <div className="rounded px-1"
               style={{ background: TARGET_HUES[(action.label) % TARGET_HUES.length] + '25',
                        fontSize: 9, fontWeight: 700,
                        color: TARGET_HUES[(action.label) % TARGET_HUES.length] }}>
            {action.label_name}
          </div>
          <span style={{ fontSize: 9, color: t.colors.textDim, fontFamily: 'monospace', flex: 1 }} className="truncate">
            {action.sample_id.slice(0, 8)}
          </span>
          <span style={{ fontSize: 9, color: t.colors.textDim }}>
            {new Date(action.labeled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            onClick={() => onUndoItem(action.sample_id)}
            title="이 레이블 취소"
            style={{ color: t.colors.textDim, padding: '1px 3px', borderRadius: 2 }}
            className="hover:text-danger transition-colors">
            <RotateCcw size={10} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── 샘플 카드 ────────────────────────────────────────────────────────────────

function SampleCard({ sample, numTargets, onLabel, onSkip, isLoading, t }: {
  sample: ALSample
  numTargets: number
  onLabel: (sampleId: string, label: number) => void
  onSkip: (sampleId: string) => void
  isLoading: boolean
  t: ReturnType<typeof useTheme>
}) {
  const topLabel = sample.classify_probs
    ? sample.classify_probs.indexOf(Math.max(...sample.classify_probs))
    : -1

  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getSampleImage(sample.sample_id)
      .then(res => { if (!cancelled) setImageUrl(res.data.image) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sample.sample_id])

  return (
    <div className="rounded overflow-hidden flex flex-col"
         style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}`,
                  opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.15s' }}>

      {/* 프레임 이미지 */}
      {imageUrl ? (
        <img src={imageUrl} alt="sample frame"
             style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '16/9', background: t.colors.bgInput,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: t.colors.textDim }}>이미지 로딩 중...</span>
        </div>
      )}

      {/* 메타 정보 */}
      <div className="p-2" style={{ borderBottom: `1px solid ${t.colors.border}` }}>
        <div className="flex items-center justify-between mb-1">
          <span style={t.badge(sample.queue_type === 'gate_margin' ? 'warning' : 'info')}>
            {sample.queue_type === 'gate_margin' ? 'GATE MARGIN' : 'UNCERTAIN'}
          </span>
          <div className="flex items-center gap-1">
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textDim }}>
              {(sample.priority_score * 100).toFixed(0)}%
            </span>
            <button
              onClick={() => onSkip(sample.sample_id)}
              disabled={isLoading}
              title="건너뛰기 (Skip)"
              style={{ color: t.colors.textDim, padding: '1px 3px' }}
              className="hover:text-accent transition-colors">
              <SkipForward size={10} />
            </button>
          </div>
        </div>

        {/* 확률 막대 */}
        {sample.classify_probs && (
          <div className="flex gap-px h-1.5 rounded-sm overflow-hidden mt-1.5">
            {sample.classify_probs.map((p, i) => (
              <div key={i} title={`T${i + 1}: ${(p * 100).toFixed(1)}%`}
                   style={{ flex: p, background: TARGET_HUES[i % TARGET_HUES.length], opacity: 0.75 }} />
            ))}
          </div>
        )}

        {/* 모델 예측 힌트 */}
        {topLabel >= 0 && sample.classify_probs && (
          <div style={{ fontSize: 9, color: t.colors.textDim, marginTop: 3 }}>
            예측: <span style={{ color: TARGET_HUES[topLabel % TARGET_HUES.length], fontWeight: 700 }}>
              T{topLabel + 1}
            </span>
            <span style={{ marginLeft: 4 }}>({(sample.classify_probs[topLabel] * 100).toFixed(1)}%)</span>
          </div>
        )}

        <div className="flex gap-3 mt-1" style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textDim }}>
          <span>gate: {sample.gate_score.toFixed(3)}</span>
          {sample.uncertainty_score > 0 && (
            <span>unc: {(sample.uncertainty_score * 100).toFixed(0)}%</span>
          )}
        </div>
      </div>

      {/* 레이블 버튼 */}
      <div className="p-2">
        <div style={{ fontSize: 10, color: t.colors.textDim, marginBottom: 3 }}>
          이 화면의 Target 종류를 선택하세요
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(numTargets, 4)}, 1fr)` }}>
          {Array.from({ length: numTargets }, (_, i) => (
            <button
              key={i}
              onClick={() => onLabel(sample.sample_id, i)}
              disabled={isLoading}
              title={`T${i + 1} 레이블 지정 (단축키: ${i < 9 ? i + 1 : '-'})`}
              className="rounded text-white transition-all active:scale-95 disabled:cursor-not-allowed"
              style={{
                padding: '6px 0',
                fontSize: 11,
                fontWeight: 700,
                background: TARGET_HUES[i % TARGET_HUES.length],
              }}>
              T{i + 1}
            </button>
          ))}
        </div>
        {isLoading && (
          <p style={{ fontSize: 9, color: t.colors.textDim, marginTop: 4, textAlign: 'center' }}>
            저장 중...
          </p>
        )}
      </div>
    </div>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────────────────────

export default function LabelReviewPage() {
  const t = useTheme()
  const { queue, stats, setQueue, pushLabelAction, undoLast, undoById, updateStats, deferSample, deferredSamples, clearDeferred } = useALStore()
  const { push: pushNotif } = useNotifStore()

  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; level: 'success' | 'error' | 'info' }>>([])
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [trainLoading, setTrainLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [numTargets, setNumTargets] = useState(4)

  // 학습 설정
  const [showTrainConfig, setShowTrainConfig] = useState(false)
  const [trainEpochs, setTrainEpochs] = useState(10)
  const [trainLr, setTrainLr] = useState('0.0001')

  // 키보드 단축키 패널
  const [showShortcuts, setShowShortcuts] = useState(false)

  // T 기준 안내 패널
  const [showTargetGuide, setShowTargetGuide] = useState(true)

  // 레이블 완료 피드백 (sampleId → 완료 상태)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())

  // Undo 이력 패널
  const { labelHistory } = useALStore()
  const [showUndoHistory, setShowUndoHistory] = useState(false)

  const toastSeq = useRef(0)

  const addToast = useCallback((msg: string, level: 'success' | 'error' | 'info' = 'success') => {
    const id = ++toastSeq.current
    setToasts(prev => [...prev.slice(-4), { id, msg, level }])
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const fetchQueue = useCallback(async () => {
    try {
      const res = await api.getALQueue()
      setQueue(res.data.samples as ALSample[])
      updateStats(res.data.stats)
      if (res.data.num_targets) setNumTargets(res.data.num_targets)
      setLoadError(false)
    } catch (err) {
      setLoadError(true)
      pushApiError(pushNotif, err, '큐 로드 실패')
    }
  }, [setQueue, updateStats, pushNotif])

  useEffect(() => {
    fetchQueue()
    const interval = setInterval(fetchQueue, 5000)
    return () => clearInterval(interval)
  }, [fetchQueue])

  const setItemLoading = (id: string, loading: boolean) => {
    setLoadingIds(prev => {
      const next = new Set(prev)
      loading ? next.add(id) : next.delete(id)
      return next
    })
  }

  const handleLabel = useCallback(async (sampleId: string, label: number) => {
    try {
      setItemLoading(sampleId, true)
      const res = await api.submitLabel(sampleId, label)
      // 낙관적 업데이트: 서버 응답 직후 로컬 큐에서 즉시 제거
      setQueue(queue.filter(s => s.sample_id !== sampleId))
      pushLabelAction({
        sample_id: sampleId,
        label,
        label_name: res.data.label_name ?? `T${label + 1}`,
        labeled_at: res.data.labeled_at ?? new Date().toISOString(),
      })
      addToast(`T${label + 1} 레이블 완료`, 'success')
      await fetchQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '레이블 실패'
      addToast(msg, 'error')
      pushApiError(pushNotif, err, '레이블 제출 실패')
    } finally {
      setItemLoading(sampleId, false)
    }
  }, [fetchQueue, pushLabelAction, addToast, pushNotif, queue, setQueue])

  const handleSkip = useCallback(async (sampleId: string) => {
    try {
      setItemLoading(sampleId, true)
      await api.skipSample(sampleId)
      deferSample(sampleId)
      setQueue(queue.filter(s => s.sample_id !== sampleId))
      addToast('샘플 건너뜀', 'info')
      fetchQueue()  // 비동기 백그라운드 동기화 (await 불필요)
    } catch (err) {
      deferSample(sampleId)
      setQueue(queue.filter(s => s.sample_id !== sampleId))
      addToast('건너뜀 (로컬)', 'info')
    } finally {
      setItemLoading(sampleId, false)
    }
  }, [fetchQueue, deferSample, addToast, queue, setQueue])

  const handleUndo = useCallback(async () => {
    const action = undoLast()
    if (!action) {
      addToast('되돌릴 레이블이 없습니다', 'info')
      return
    }
    try {
      await api.undoLabel(action.sample_id)
      addToast(`${action.label_name} 레이블 취소됨`, 'success')
      await fetchQueue()
    } catch (err) {
      // 되돌리기 실패 시 store에 다시 넣음
      pushLabelAction(action)
      addToast(err instanceof Error ? err.message : 'Undo 실패', 'error')
      pushApiError(pushNotif, err, 'Undo 실패')
    }
  }, [undoLast, pushLabelAction, fetchQueue, addToast, pushNotif])

  const handleUndoById = useCallback(async (sampleId: string) => {
    const action = undoById(sampleId)
    if (!action) {
      addToast('해당 샘플 이력을 찾을 수 없습니다', 'error')
      return
    }
    try {
      await api.undoLabel(action.sample_id)
      addToast(`${action.label_name} 레이블 취소됨`, 'success')
      await fetchQueue()
    } catch (err) {
      pushLabelAction(action)
      addToast(err instanceof Error ? err.message : 'Undo 실패', 'error')
      pushApiError(pushNotif, err, 'Undo 실패')
    }
  }, [undoById, pushLabelAction, fetchQueue, addToast, pushNotif])

  const handleTrain = async () => {
    const lr = parseFloat(trainLr)
    if (isNaN(lr) || lr <= 0) {
      addToast('학습률이 올바르지 않습니다 (예: 0.0001)', 'error')
      return
    }
    if (!window.confirm(`레이블된 샘플 ${stats.labeled_count}개로 모델을 재학습합니다.\n재학습은 몇 분 이상 소요될 수 있습니다. 계속하시겠습니까?`)) {
      return
    }
    setTrainLoading(true)
    try {
      const res = await api.triggerTraining(trainEpochs, lr)
      const acc = res.data.final_metrics?.accuracy
      addToast(`재학습 완료${acc != null ? `: Acc ${(acc * 100).toFixed(1)}%` : ''}`, 'success')
      await fetchQueue()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '재학습 실패'
      addToast(msg, 'error')
      pushApiError(pushNotif, err, '재학습 실패', handleTrain)
    } finally {
      setTrainLoading(false)
    }
  }

  // ── 키보드 단축키 ─────────────────────────────────────────────────────
  const visibleQueue = queue.filter(s => !deferredSamples.includes(s.sample_id))

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // 입력 필드에서는 무시
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Ctrl+Z: 마지막 undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
        return
      }

      const key = e.key
      const firstSample = visibleQueue[0]
      if (!firstSample) return

      // 숫자키 1-9: 첫 번째 샘플에 레이블
      const num = parseInt(key, 10)
      if (!isNaN(num) && num >= 1 && num <= numTargets) {
        e.preventDefault()
        handleLabel(firstSample.sample_id, num - 1)
        return
      }

      // S: 스킵
      if (key === 's' || key === 'S') {
        e.preventDefault()
        handleSkip(firstSample.sample_id)
        return
      }

      // R: 새로고침
      if (key === 'r' || key === 'R') {
        e.preventDefault()
        fetchQueue()
        return
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [visibleQueue, numTargets, handleLabel, handleSkip, handleUndo, fetchQueue])

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── 사이드바: Undo 이력 + 단축키 ── */}
      <div className="flex-shrink-0 flex flex-col gap-px overflow-hidden" style={{ width: 220 }}>

        {/* Undo 이력 */}
        <div className="flex-1 overflow-hidden flex flex-col p-2" style={{ background: t.colors.bgPanel }}>
          <button
            onClick={() => setShowUndoHistory(v => !v)}
            className="flex items-center gap-1.5 mb-1.5 w-full"
            style={{ fontSize: 11, fontWeight: 600, color: t.colors.textHeading }}>
            <History size={12} style={{ color: t.colors.accent }} />
            레이블 이력
            <span style={{ fontSize: 9, color: t.colors.textDim, marginLeft: 'auto', fontFamily: 'monospace' }}>
              {labelHistory.length}건
            </span>
            {showUndoHistory
              ? <ChevronUp size={11} style={{ color: t.colors.textDim }} />
              : <ChevronDown size={11} style={{ color: t.colors.textDim }} />}
          </button>

          {showUndoHistory && (
            <UndoHistoryPanel
              history={labelHistory}
              onUndoItem={handleUndoById}
              t={t}
            />
          )}

          {!showUndoHistory && (
            <div className="text-center py-3" style={{ fontSize: 10, color: t.colors.textDim }}>
              클릭하면 이력이 표시됩니다
            </div>
          )}
        </div>

        {/* 키보드 단축키 */}
        <div className="p-2 flex-shrink-0" style={{ background: t.colors.bgPanel }}>
          <button
            onClick={() => setShowShortcuts(v => !v)}
            className="flex items-center gap-1.5 w-full mb-1.5"
            style={{ fontSize: 11, fontWeight: 600, color: t.colors.textHeading }}>
            <Keyboard size={12} style={{ color: t.colors.accent }} />
            단축키
            {showShortcuts
              ? <ChevronUp size={11} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />
              : <ChevronDown size={11} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />}
          </button>

          {showShortcuts && (
            <div className="space-y-0.5">
              {[
                ['1 ~ ' + numTargets, `T1 ~ T${numTargets} 레이블`],
                ['S', '첫 샘플 건너뛰기'],
                ['R', '큐 새로고침'],
                ['Ctrl+Z', '마지막 레이블 취소'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd style={{
                    fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                    background: t.colors.bgInput, border: `1px solid ${t.colors.border}`,
                    borderRadius: 3, padding: '1px 5px', color: t.colors.accent,
                    flexShrink: 0,
                  }}>{key}</kbd>
                  <span style={{ fontSize: 10, color: t.colors.textDim }}>{desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 학습 설정 */}
        <div className="p-2 flex-shrink-0" style={{ background: t.colors.bgPanel }}>
          <button
            onClick={() => setShowTrainConfig(v => !v)}
            className="flex items-center gap-1.5 w-full mb-1.5"
            style={{ fontSize: 11, fontWeight: 600, color: t.colors.textHeading }}>
            <Settings2 size={12} style={{ color: t.colors.accent }} />
            학습 설정
            {showTrainConfig
              ? <ChevronUp size={11} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />
              : <ChevronDown size={11} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />}
          </button>

          {showTrainConfig && (
            <div className="space-y-2">
              <div>
                <div className="flex justify-between mb-0.5">
                  <label style={{ fontSize: 10, color: t.colors.textMuted }}>에폭 수</label>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.accent }}>{trainEpochs}</span>
                </div>
                <input
                  type="range" min={1} max={50} value={trainEpochs}
                  onChange={e => setTrainEpochs(Number(e.target.value))}
                  style={{ width: '100%', accentColor: t.colors.accent }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: t.colors.textMuted, display: 'block', marginBottom: 2 }}>
                  학습률 (LR)
                </label>
                <input
                  value={trainLr}
                  onChange={e => setTrainLr(e.target.value)}
                  placeholder="예: 0.0001"
                  style={{ ...t.input, fontSize: 10, width: '100%' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 메인 영역 ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-3 py-2 flex items-center justify-between gap-2"
             style={{ borderBottom: `1px solid ${t.colors.border}`, background: t.colors.bgPanel }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: t.colors.textHeading }}>Active Learning</span>
            <span style={{ fontSize: 10, color: t.colors.textMuted, marginLeft: 8, fontFamily: 'monospace' }}>
              미분류 {stats.unlabeled_count}
              {deferredSamples.length > 0 && (
                <span style={{ color: t.colors.textDim }}> (건너뜀 {deferredSamples.length})</span>
              )}
              {' / '}완료 {stats.labeled_count}
              {' / '}총 {stats.total_added}
            </span>
          </div>
          <div className="flex gap-1">
            <button onClick={handleUndo} title="마지막 레이블 취소 (Ctrl+Z)" style={t.btnSecondary}>
              <RotateCcw size={11} /> Undo
            </button>
            {deferredSamples.length > 0 && (
              <button onClick={clearDeferred} title="건너뜀 샘플 복원" style={t.btnSecondary}>
                <RefreshCw size={11} /> 복원 ({deferredSamples.length})
              </button>
            )}
            <button onClick={fetchQueue} title="새로고침 (R)" style={t.btnSecondary}>
              <RefreshCw size={11} /> 새로고침
            </button>
            <button
              onClick={handleTrain}
              disabled={trainLoading || stats.labeled_count === 0}
              title={stats.labeled_count === 0 ? '레이블된 샘플이 없습니다' : `${stats.labeled_count}개 샘플로 재학습`}
              style={t.btnPrimary}>
              <Zap size={11} />
              {trainLoading ? '학습 중...' : `재학습 (${stats.labeled_count})`}
            </button>
          </div>
        </div>

        {/* 토스트 알림 영역 */}
        {toasts.length > 0 && (
          <div className="px-3 pt-2 space-y-1 flex-shrink-0">
            {toasts.map(toast => (
              <InlineToast
                key={toast.id}
                msg={toast.msg}
                level={toast.level}
                onDismiss={() => dismissToast(toast.id)}
              />
            ))}
          </div>
        )}

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-3">
          {loadError ? (
            <div className="rounded p-6 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
              <AlertCircle size={20} style={{ margin: '0 auto 8px', color: t.colors.danger }} />
              <p style={{ fontSize: 12, color: t.colors.textMuted, marginBottom: 4 }}>
                백엔드 서버에 연결할 수 없습니다
              </p>
              <p style={{ fontSize: 11, color: t.colors.textDim, marginBottom: 8 }}>
                서버를 시작한 후 새로고침 버튼을 눌러주세요
              </p>
              <button onClick={fetchQueue} style={{ ...t.btnPrimary, fontSize: 11 }}>
                <RefreshCw size={11} /> 다시 시도
              </button>
            </div>
          ) : visibleQueue.length === 0 ? (
            <div className="rounded p-6 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
              <CheckCircle2 size={20} style={{ margin: '0 auto 8px', color: t.colors.success }} />
              <p style={{ fontSize: 12, color: t.colors.textMuted }}>레이블링할 샘플이 없습니다</p>
              <p style={{ fontSize: 11, color: t.colors.textDim, marginTop: 4 }}>
                {deferredSamples.length > 0
                  ? `건너뛴 샘플 ${deferredSamples.length}개 있음 — 위 "복원" 버튼을 누르세요`
                  : '시스템 실행 중 불확실한 샘플이 자동으로 수집됩니다'}
              </p>
            </div>
          ) : (
            <>
              {/* 첫 번째 샘플 강조 */}
              {visibleQueue.length > 0 && (
                <div className="mb-2 flex items-center gap-2 rounded px-2 py-1.5"
                     style={{ background: t.colors.accent + '12', border: `1px solid ${t.colors.accent}25` }}>
                  <span style={{ fontSize: 11, color: t.colors.text }}>
                    파란 테두리 이미지부터 버튼을 클릭해서 종류를 선택하세요
                  </span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {visibleQueue.map((sample, idx) => (
                  <div key={sample.sample_id}
                       style={idx === 0 ? { outline: `2px solid ${t.colors.accent}40`, borderRadius: 6 } : {}}>
                    <SampleCard
                      sample={sample}
                      numTargets={numTargets}
                      onLabel={handleLabel}
                      onSkip={handleSkip}
                      isLoading={loadingIds.has(sample.sample_id)}
                      t={t}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
