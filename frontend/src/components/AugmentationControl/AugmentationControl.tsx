import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import type { AugIntensity, IntensityOption } from '../../types'

const INTENSITY_ORDER: AugIntensity[] = [
  'weak', 'medium_weak', 'medium', 'medium_strong', 'strong', 'extreme',
]

const INTENSITY_COLORS: Record<AugIntensity, { base: string; active: string }> = {
  weak:          { base: 'bg-sky-600/60 border-sky-600/40 hover:bg-sky-600/80', active: 'bg-sky-500 border-sky-400 ring-1 ring-sky-400/40' },
  medium_weak:   { base: 'bg-teal-600/60 border-teal-600/40 hover:bg-teal-600/80', active: 'bg-teal-500 border-teal-400 ring-1 ring-teal-400/40' },
  medium:        { base: 'bg-emerald-600/60 border-emerald-600/40 hover:bg-emerald-600/80', active: 'bg-emerald-500 border-emerald-400 ring-1 ring-emerald-400/40' },
  medium_strong: { base: 'bg-amber-600/60 border-amber-600/40 hover:bg-amber-600/80', active: 'bg-amber-500 border-amber-400 ring-1 ring-amber-400/40' },
  strong:        { base: 'bg-orange-600/60 border-orange-600/40 hover:bg-orange-600/80', active: 'bg-orange-500 border-orange-400 ring-1 ring-orange-400/40' },
  extreme:       { base: 'bg-red-700/60 border-red-700/40 hover:bg-red-700/80', active: 'bg-red-600 border-red-400 ring-1 ring-red-400/40' },
}

interface Props {
  intensity: AugIntensity
  nPerTarget: number
  intensityOptions: Record<AugIntensity, IntensityOption>
  onIntensityChange: (v: AugIntensity) => void
  onNPerTargetChange: (v: number) => void
}

function Tooltip({ text, visible }: { text: string; visible: boolean }) {
  if (!visible) return null
  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48
                    bg-[#1e293b] border border-[#334155] rounded
                    px-2.5 py-1.5 text-[11px] text-slate-300 shadow-lg pointer-events-none">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2
                      border-4 border-transparent border-t-[#334155]" />
    </div>
  )
}

export default function AugmentationControl({
  intensity,
  nPerTarget,
  intensityOptions,
  onIntensityChange,
  onNPerTargetChange,
}: Props) {
  const [tooltip, setTooltip] = useState<AugIntensity | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showTooltip = (key: AugIntensity) => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    setTooltip(key)
  }

  const hideTooltip = () => {
    tooltipTimerRef.current = setTimeout(() => setTooltip(null), 150)
  }

  useEffect(() => () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
  }, [])

  return (
    <div className="space-y-5">
      {/* 강도 선택 */}
      <div>
        <p className="text-[11px] text-slate-500 mb-2">증강 강도</p>
        <div className="flex flex-wrap gap-1.5">
          {INTENSITY_ORDER.map((key) => {
            const opt = intensityOptions[key]
            const isActive = intensity === key
            const colors = INTENSITY_COLORS[key]

            return (
              <div key={key} className="relative flex items-center">
                <button
                  onClick={() => onIntensityChange(key)}
                  className={`px-2.5 py-1 rounded-l border text-[11px] font-medium
                              text-white transition-all duration-150 ${
                                isActive ? colors.active : colors.base
                              }`}
                >
                  {opt?.label ?? key}
                </button>

                <div
                  className={`relative px-1 py-1 rounded-r border-y border-r
                               cursor-pointer transition-colors duration-150
                               ${isActive
                                 ? `${colors.active} border-l-0`
                                 : `${colors.base} border-l-0 opacity-70`}`}
                  onMouseEnter={() => showTooltip(key)}
                  onMouseLeave={hideTooltip}
                  onClick={() => showTooltip(tooltip === key ? null as never : key)}
                >
                  <Info size={11} className="text-white/80" />
                  <Tooltip
                    text={opt?.description ?? ''}
                    visible={tooltip === key}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {intensity && intensityOptions[intensity] && (
          <p className="mt-2 text-[11px] text-slate-500">
            <span className="text-slate-300 font-medium">
              {intensityOptions[intensity].label}
            </span>
            {' -- '}
            {intensityOptions[intensity].description}
          </p>
        )}
      </div>

      {/* 타겟당 증강 수 */}
      <div>
        <label className="text-[11px] text-slate-500 block mb-1.5">
          타겟당 증강 수
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={50}
            max={2000}
            step={50}
            value={nPerTarget}
            onChange={(e) => onNPerTargetChange(Number(e.target.value))}
            className="flex-1"
          />
          <input
            type="number"
            min={10}
            max={5000}
            value={nPerTarget}
            onChange={(e) => {
              const v = Math.max(10, Math.min(5000, Number(e.target.value)))
              onNPerTargetChange(v)
            }}
            className="input w-16 text-center text-xs"
          />
          <span className="text-[10px] text-slate-600 whitespace-nowrap">/ target</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-600">
          총 생성: <span className="text-slate-400 font-mono">targets x {nPerTarget.toLocaleString()}</span>
        </p>
      </div>
    </div>
  )
}
