import { CheckCircle, Circle, Clock } from 'lucide-react'
import type { InferenceResult, SequenceState } from '../../types'

interface Props {
  currentState: SequenceState
  lastResult: InferenceResult | null
}

const SEQUENCE_STEPS = [
  { id: 1, label: 'Target 1', state: 'WAIT_T1' },
  { id: 2, label: 'Target 2', state: 'WAIT_T2' },
  { id: 3, label: 'Target 3', state: 'WAIT_T3' },
  { id: 4, label: 'Target 4', state: 'WAIT_T4' },
]

function getStepStatus(stepState: string, currentState: SequenceState) {
  const stateOrder = ['WAIT_T1', 'WAIT_T2', 'WAIT_T3', 'WAIT_T4', 'COMPLETE']
  const currentIdx = stateOrder.indexOf(currentState)
  const stepIdx = stateOrder.indexOf(stepState)

  if (currentState === 'COMPLETE') return 'done'
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return 'active'
  return 'pending'
}

export default function SequenceIndicator({ currentState, lastResult }: Props) {
  const isComplete = currentState === 'COMPLETE'
  const violation = lastResult?.sequence?.violation_reason

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">검출 순서</h2>
        {isComplete && (
          <span className="text-xs px-2 py-0.5 bg-green-900 text-green-300 rounded-full">완료!</span>
        )}
      </div>

      {/* 진행 표시 */}
      <div className="flex items-center gap-2 mb-4">
        {SEQUENCE_STEPS.map((step, i) => {
          const status = getStepStatus(step.state, currentState)
          return (
            <div key={step.id} className="flex items-center gap-2">
              <div className={`flex flex-col items-center gap-1 ${
                status === 'active' ? 'scale-110 transition-transform' : ''
              }`}>
                {status === 'done' ? (
                  <CheckCircle size={28} className="text-green-400" />
                ) : status === 'active' ? (
                  <div className="relative">
                    <Clock size={28} className="text-blue-400 animate-pulse" />
                  </div>
                ) : (
                  <Circle size={28} className="text-gray-700" />
                )}
                <span className={`text-xs font-medium ${
                  status === 'done' ? 'text-green-400'
                  : status === 'active' ? 'text-blue-400'
                  : 'text-gray-600'
                }`}>
                  T{step.id}
                </span>
              </div>
              {i < SEQUENCE_STEPS.length - 1 && (
                <div className={`h-0.5 w-6 ${
                  getStepStatus(SEQUENCE_STEPS[i + 1].state, currentState) !== 'pending'
                    ? 'bg-green-400' : 'bg-gray-700'
                }`} />
              )}
            </div>
          )
        })}
      </div>

      {/* 현재 상태 */}
      <div className={`text-sm rounded-lg px-3 py-2 ${
        isComplete
          ? 'bg-green-900/50 text-green-300'
          : violation
          ? 'bg-red-900/50 text-red-300'
          : 'bg-gray-800 text-gray-300'
      }`}>
        {isComplete
          ? '🎉 모든 Target 검출 완료!'
          : violation
          ? `⚠ ${violation}`
          : `대기 중: ${currentState.replace('WAIT_', 'Target ')}`}
      </div>
    </div>
  )
}
