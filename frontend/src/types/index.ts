export interface GateResult {
  is_target: boolean
  normalized_score: number
  in_margin: boolean
  latency_ms: number
  model: string
}

export interface ClassifyResult {
  target_id: number
  confidence: number
  probabilities: number[]
  is_uncertain: boolean
  margin: number
  latency_ms: number
}

export interface SequenceResult {
  accepted: boolean
  current_state: string
  next_expected: number | null
  violation_reason: string | null
}

export interface InferenceResult {
  frame_id: string
  is_confirmed: boolean
  gate: GateResult | null
  classify: ClassifyResult | null
  sequence: SequenceResult | null
  total_latency_ms: number
  timestamp: string
  error: string | null
  frame_count?: number
}

export interface MetricsSnapshot {
  timestamp: string
  window_size: number
  // 기본 분류
  accuracy: number
  f1: number
  precision: number
  recall: number
  confusion_matrix: number[][]
  per_class_f1: number[]
  cm_diagonal_ratio: number[]
  // 레이턴시
  avg_latency_ms: number
  p95_latency_ms: number
  gate_latency_avg_ms: number
  gate_latency_p95_ms: number
  classify_latency_avg_ms: number
  classify_latency_p95_ms: number
  // Stage 2
  gate_pass_rate: number
  ood_recall: number
  auroc: number
  // Stage 3
  low_confidence_ratio: number
  ece: number
  // Stage 4
  sequence_error_rate: number
  false_block_rate: number
  sequence_completion_rate: number
  e2e_latency_ms: number
  system_precision: number
  // AL
  al_queue_size: number
  confirmed_count: number
  psi_score: number
  al_query_hit_rate: number
}

export type KpiStatus = 'pass' | 'warn' | 'fail' | 'na'

export interface KpiEntry {
  key: string
  label: string
  value: number
  display: string
  target: string
  status: KpiStatus
  priority: number
  need_gt?: boolean
  unit?: string
}

export interface KpiReport {
  summary: { total: number; pass: number; warn: number; fail: number; na: number }
  stages: {
    stage1: KpiEntry[]
    stage2: KpiEntry[]
    stage3: KpiEntry[]
    stage4: KpiEntry[]
    al: KpiEntry[]
  }
}

export interface ALSample {
  sample_id: string
  queue_type: 'gate_margin' | 'classify_uncertain'
  gate_score: number
  uncertainty_score: number
  margin_score: number
  priority_score: number
  added_at: string
  classify_probs: number[] | null
}

// 타겟 수 동적 지원 — WAIT_T1 ~ WAIT_Tn + COMPLETE + IDLE
export type SequenceState = string

export type AppMode = 'live' | 'test' | 'idle'

// ── 학습 설정 타입 ────────────────────────────────────────────────────────

export type AugIntensity =
  | 'weak' | 'medium_weak' | 'medium' | 'medium_strong' | 'strong' | 'extreme'

export interface IntensityOption {
  label: string          // 표시 이름 (약/중약/중/중강/강/최강)
  description: string    // 툴팁 설명
}

export interface PreprocessStep {
  id: string
  label: string
  description: string
}

export interface PreprocessConfigState {
  input_size: [number, number]
  optional_steps: string[]
  clahe_clip_limit: number
  clahe_tile_grid: [number, number]
  denoise_h: number
  sharpen_amount: number
}

export interface TrainingConfig {
  num_targets: number
  preprocess: PreprocessConfigState
  augmentation: {
    intensity: AugIntensity
    n_per_target: number
  }
}

// ── 감지 알림 타입 ────────────────────────────────────────────────────────

export type AlertSeverity = 'error' | 'warning' | 'info' | 'success'

export interface DetectionAlert {
  event: 'alert'
  camera_id: string
  target_id: number
  target_name: string
  screen_desc: string
  situation: string
  action: string
  action_steps: string[]
  urgency: string
  severity: AlertSeverity
  occurrence_count: number
  frame_count: number
  timestamp: string
  acknowledged?: boolean
}

export interface TrainingConfigMeta {
  preprocess: {
    mandatory: PreprocessStep[]
    optional_available: Record<string, { label: string; description: string; default: boolean }>
    optional_active: string[]
  }
  augmentation: {
    intensity_options: Record<AugIntensity, IntensityOption>
  }
}
