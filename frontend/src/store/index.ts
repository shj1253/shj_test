import { create } from 'zustand'
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
  maxHistory: 60,  // 60초 이력

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

interface LabelAction {
  sample_id: string
  label: number
  labeled_at: string
}

interface ALStore {
  queue: ALSample[]
  labelHistory: LabelAction[]  // Undo 스택
  stats: {
    unlabeled_count: number
    labeled_count: number
    total_added: number
  }

  setQueue: (samples: ALSample[]) => void
  pushLabelAction: (action: LabelAction) => void
  undoLast: () => LabelAction | null
  updateStats: (stats: ALStore['stats']) => void
}

export const useALStore = create<ALStore>((set, get) => ({
  queue: [],
  labelHistory: [],
  stats: { unlabeled_count: 0, labeled_count: 0, total_added: 0 },

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
  updateStats: (stats) => set({ stats }),
}))
