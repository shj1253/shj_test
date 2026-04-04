import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { InferenceResult, SequenceState } from '../../types'

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
  const n = numTargets ?? parseNumTargets(currentState)
  const steps = buildSteps(n)
  const isComplete = currentState === 'COMPLETE'
  const violation = lastResult?.sequence?.violation_reason

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="panel-header">검출 시퀀스</h2>
        {isComplete && <span className="badge badge-success">COMPLETE</span>}
      </div>

      {/* 진행 바 */}
      <div className="flex items-center gap-1 mb-4">
        {steps.map((step, i) => {
          const status = getStepStatus(step.state, currentState, n)
          return (
            <div key={step.id} className="flex items-center gap-1 flex-1">
              <div className="flex flex-col items-center gap-1 min-w-0">
                <div className={`transition-transform duration-200 ${status === 'active' ? 'scale-110' : ''}`}>
                  {status === 'done' ? (
                    <CheckCircle2 size={22} className="text-emerald-400" strokeWidth={2} />
                  ) : status === 'active' ? (
                    <Loader2 size={22} className="text-blue-400 animate-spin" strokeWidth={2} />
                  ) : (
                    <Circle size={22} className="text-slate-700" strokeWidth={1.5} />
                  )}
                </div>
                <span className={`text-[10px] font-mono font-medium ${
                  status === 'done' ? 'text-emerald-400'
                  : status === 'active' ? 'text-blue-400'
                  : 'text-slate-600'
                }`}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-px flex-1 mx-0.5 transition-colors duration-300 ${
                  getStepStatus(steps[i + 1].state, currentState, n) !== 'pending'
                    ? 'bg-emerald-500/40' : 'bg-slate-800'
                }`} />
              )}
            </div>
          )
        })}
      </div>

      {/* 상태 메시지 */}
      <div className={`text-xs rounded px-3 py-2 ${
        isComplete
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : violation
          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : 'bg-[#0f172a] text-slate-400 border border-[#1e293b]'
      }`}>
        {isComplete
          ? '모든 Target 검출 완료'
          : violation
          ? `순서 위반: ${violation}`
          : `대기 중 -- ${currentState.replace('WAIT_', 'Target ')}`}
      </div>
    </div>
  )
}
