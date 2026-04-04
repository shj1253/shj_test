import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { InferenceResult, SequenceState } from '../../types'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  currentState: SequenceState
  lastResult: InferenceResult | null
  numTargets?: number
}

function parseNumTargets(state: SequenceState): number {
  const match = state.match(/WAIT_T(\d+)/)
  return match ? Math.max(4, parseInt(match[1])) : 4
}

function buildSteps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    label: `T${i + 1}`,
    state: `WAIT_T${i + 1}`,
  }))
}

function getStepStatus(stepState: string, currentState: SequenceState, totalSteps: number) {
  const stateOrder = [
    ...Array.from({ length: totalSteps }, (_, i) => `WAIT_T${i + 1}`),
    'COMPLETE',
  ]
  const currentIdx = stateOrder.indexOf(currentState)
  const stepIdx = stateOrder.indexOf(stepState)

  if (currentState === 'COMPLETE') return 'done' as const
  if (stepIdx < currentIdx) return 'done' as const
  if (stepIdx === currentIdx) return 'active' as const
  return 'pending' as const
}

export default function SequenceIndicator({ currentState, lastResult, numTargets }: Props) {
  const t = useTheme()
  const n = numTargets ?? parseNumTargets(currentState)
  const steps = buildSteps(n)
  const isComplete = currentState === 'COMPLETE'
  const violation = lastResult?.sequence?.violation_reason

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div style={t.sectionHeader}>검출 시퀀스</div>
        {isComplete && <span style={t.badge('success')}>COMPLETE</span>}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-0.5 mb-2">
        {steps.map((step, i) => {
          const status = getStepStatus(step.state, currentState, n)
          return (
            <div key={step.id} className="flex items-center gap-0.5 flex-1">
              <div className="flex flex-col items-center gap-0.5 min-w-0">
                {status === 'done' ? (
                  <CheckCircle2 size={18} style={{ color: t.colors.success }} strokeWidth={2} />
                ) : status === 'active' ? (
                  <Loader2 size={18} style={{ color: t.colors.accent }} className="animate-spin" strokeWidth={2} />
                ) : (
                  <Circle size={18} style={{ color: t.colors.textDim }} strokeWidth={1.5} />
                )}
                <span style={{
                  fontSize: 9,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  color: status === 'done' ? t.colors.success
                       : status === 'active' ? t.colors.accent
                       : t.colors.textDim,
                }}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 mx-0.5" style={{
                  height: 1,
                  background: getStepStatus(steps[i + 1].state, currentState, n) !== 'pending'
                    ? t.colors.success + '60' : t.colors.border,
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Status message */}
      <div className="rounded px-2 py-1.5" style={{
        fontSize: 11,
        background: isComplete ? t.colors.success + '12'
                    : violation ? t.colors.danger + '12'
                    : t.colors.bgInput,
        color: isComplete ? t.colors.success
               : violation ? t.colors.danger
               : t.colors.textMuted,
        border: `1px solid ${isComplete ? t.colors.success + '25'
                              : violation ? t.colors.danger + '25'
                              : t.colors.border}`,
      }}>
        {isComplete
          ? '모든 Target 검출 완료'
          : violation
          ? `순서 위반: ${violation}`
          : `대기 중 -- ${currentState.replace('WAIT_', 'Target ')}`}
      </div>
    </div>
  )
}
