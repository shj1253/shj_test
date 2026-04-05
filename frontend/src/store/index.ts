import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  InferenceResult, MetricsSnapshot, ALSample, SequenceState, AppMode
} from '../types'

// ── Inference Store ────────────────────────────────────────────────────────

interface InferenceStore {
  mode: AppMode
  lastResult: InferenceResult | null
  sequenceState: SequenceState
  sequenceHistory: Array<{ target_id: number; timestamp: string; accepted: boolean }>
  frameCount: number
  isStreaming: boolean

  setMode: (mode: AppMode) => void
  setResult: (result: InferenceResult) => void
  setStreaming: (v: boolean) => void
  resetSequence: () => void
}

export const useInferenceStore = create<InferenceStore>((set) => ({
  mode: 'idle',
  lastResult: null,
  sequenceState: 'WAIT_T1',
  sequenceHistory: [],
  frameCount: 0,
  isStreaming: false,

  setMode: (mode) => set({ mode }),
  setResult: (result) =>
    set((s) => ({
      lastResult: result,
      frameCount: result.frame_count ?? s.frameCount + 1,
      sequenceState: (result.sequence?.current_state as SequenceState) ?? s.sequenceState,
      sequenceHistory: result.sequence?.accepted
        ? [
            ...s.sequenceHistory,
            {
              target_id: result.classify?.target_id ?? 0,
              timestamp: result.timestamp,
              accepted: true,
            },
          ]
        : s.sequenceHistory,
    })),
  setStreaming: (v) => set({ isStreaming: v }),
  resetSequence: () =>
    set({ sequenceState: 'WAIT_T1', sequenceHistory: [] }),
}))

// ── Metrics Store ──────────────────────────────────────────────────────────

interface MetricsStore {
  current: MetricsSnapshot | null
  history: MetricsSnapshot[]
  maxHistory: number

  updateMetrics: (snapshot: MetricsSnapshot) => void
  resetMetrics: () => void
}

export const useMetricsStore = create<MetricsStore>((set) => ({
  current: null,
  history: [],
  maxHistory: 60,

  updateMetrics: (snapshot) =>
    set((s) => ({
      current: snapshot,
      history: [
        ...s.history.slice(-(s.maxHistory - 1)),
        snapshot,
      ],
    })),
  resetMetrics: () => set({ current: null, history: [] }),
}))

// ── AL Store ───────────────────────────────────────────────────────────────

export interface LabelAction {
  sample_id: string
  label: number
  label_name: string   // "T1", "T2", ...
  labeled_at: string
}

interface ALStore {
  queue: ALSample[]
  labelHistory: LabelAction[]  // Undo 스택
  deferredSamples: string[] // 세션 내 스킵된 샘플 ID
  stats: {
    unlabeled_count: number
    labeled_count: number
    total_added: number
    undo_stack_depth?: number
  }

  setQueue: (samples: ALSample[]) => void
  pushLabelAction: (action: LabelAction) => void
  undoLast: () => LabelAction | null
  undoById: (sampleId: string) => LabelAction | null
  updateStats: (stats: ALStore['stats']) => void
  deferSample: (sampleId: string) => void
  clearDeferred: () => void
}

export const useALStore = create<ALStore>((set, get) => ({
  queue: [],
  labelHistory: [],
  deferredSamples: [],
  stats: { unlabeled_count: 0, labeled_count: 0, total_added: 0, undo_stack_depth: 0 },

  setQueue: (queue) => set({ queue }),

  pushLabelAction: (action) =>
    set((s) => ({ labelHistory: [...s.labelHistory, action] })),

  undoLast: () => {
    const history = get().labelHistory
    if (history.length === 0) return null
    const last = history[history.length - 1]
    set({ labelHistory: history.slice(0, -1) })
    return last
  },

  undoById: (sampleId: string) => {
    const history = get().labelHistory
    const idx = [...history].reverse().findIndex(a => a.sample_id === sampleId)
    if (idx === -1) return null
    const realIdx = history.length - 1 - idx
    const action = history[realIdx]
    set({ labelHistory: history.filter((_, i) => i !== realIdx) })
    return action
  },

  updateStats: (stats) => set({ stats }),

  deferSample: (sampleId) =>
    set((s) => ({
      deferredSamples: s.deferredSamples.includes(sampleId)
        ? s.deferredSamples
        : [...s.deferredSamples, sampleId],
    })),

  clearDeferred: () => set({ deferredSamples: [] }),
}))

// ── Global Error / Notification Store ─────────────────────────────────────

export type NotifLevel = 'error' | 'warning' | 'info' | 'success'

export interface AppNotification {
  id: string
  level: NotifLevel
  message: string
  hint?: string
  retryFn?: () => void
  timestamp: string
}

interface NotifStore {
  notifications: AppNotification[]
  push: (n: Omit<AppNotification, 'id' | 'timestamp'>) => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

let _notifSeq = 0

export const useNotifStore = create<NotifStore>()(
  persist(
    (set) => ({
      notifications: [],

      push: (n) => {
        const id = String(++_notifSeq)
        set((s) => ({
          notifications: [
            ...s.notifications.slice(-49),  // 최대 50개 유지
            { ...n, id, timestamp: new Date().toISOString() },
          ],
        }))
      },

      dismiss: (id) =>
        set((s) => ({ notifications: s.notifications.filter(n => n.id !== id) })),

      dismissAll: () => set({ notifications: [] }),
    }),
    {
      name: 'cannon-notifications',  // localStorage key
      // retryFn은 직렬화 불가 → 저장 제외
      partialize: (s) => ({
        notifications: s.notifications.map(({ retryFn: _, ...rest }) => rest),
      }),
    }
  )
)

// ── 편의 함수: API 에러를 notification으로 변환 ───────────────────────────

export function pushApiError(
  push: NotifStore['push'],
  err: unknown,
  context: string,
  retryFn?: () => void,
) {
  let message = context
  let hint: string | undefined

  if (err instanceof Error) {
    message = err.message || context
  }

  // axios 에러에서 hint 추출
  const anyErr = err as any
  if (anyErr?.response?.data?.hint) {
    hint = anyErr.response.data.hint
  } else if (anyErr?.response?.data?.detail) {
    hint = anyErr.response.data.detail
  }

  push({ level: 'error', message, hint, retryFn })
}
