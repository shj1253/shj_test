import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import type { AugIntensity, IntensityOption } from '../../types'

const INTENSITY_ORDER: AugIntensity[] = [
  'weak', 'medium_weak', 'medium', 'medium_strong', 'strong', 'extreme',
]

const INTENSITY_HUES: Record<AugIntensity, string> = {
  weak: '#38bdf8',
  medium_weak: '#2dd4bf',
  medium: '#4ade80',
  medium_strong: '#facc15',
  strong: '#fb923c',
  extreme: '#ef4444',
}

interface Props {
  intensity: AugIntensity
  nPerTarget: number
  intensityOptions: Record<AugIntensity, IntensityOption>
  onIntensityChange: (v: AugIntensity) => void
  onNPerTargetChange: (v: number) => void
}

export default function AugmentationControl({
  intensity, nPerTarget, intensityOptions, onIntensityChange, onNPerTargetChange,
}: Props) {
  const t = useTheme()
  const [tooltip, setTooltip] = useState<AugIntensity | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (key: AugIntensity) => { if (timerRef.current) clearTimeout(timerRef.current); setTooltip(key) }
  const hide = () => { timerRef.current = setTimeout(() => setTooltip(null), 150) }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div className="space-y-4">
      {/* Intensity */}
      <div>
        <div style={{ fontSize: 11, color: t.colors.textMuted, marginBottom: 6 }}>증강 강도</div>
        <div className="flex flex-wrap gap-1">
          {INTENSITY_ORDER.map((key) => {
            const opt = intensityOptions[key]
            const isActive = intensity === key
            const hue = INTENSITY_HUES[key]

            return (
              <div key={key} className="relative flex items-center">
                <button
                  onClick={() => onIntensityChange(key)}
                  className="rounded-l transition-all duration-150"
                  style={{
                    padding: '3px 8px',
                    fontSize: 11,
                    fontWeight: 500,
                    color: isActive ? '#fff' : t.colors.text,
                    background: isActive ? hue : t.colors.bgInput,
                    border: `1px solid ${isActive ? hue : t.colors.border}`,
                    borderRight: 'none',
                    boxShadow: isActive ? `0 0 6px ${hue}40` : 'none',
                  }}
                >
                  {opt?.label ?? key}
                </button>
                <div
                  className="relative rounded-r cursor-pointer transition-colors"
                  style={{
                    padding: '3px 4px',
                    background: isActive ? hue : t.colors.bgInput,
                    border: `1px solid ${isActive ? hue : t.colors.border}`,
                    borderLeft: 'none',
                    opacity: isActive ? 1 : 0.6,
                  }}
                  onMouseEnter={() => show(key)}
                  onMouseLeave={hide}
                  onClick={() => show(tooltip === key ? null as never : key)}
                >
                  <Info size={10} style={{ color: isActive ? '#fff' : t.colors.textMuted }} />
                  {tooltip === key && opt && (
                    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 rounded px-2 py-1.5 shadow-lg pointer-events-none"
                         style={{ background: t.colors.bgActivityBar, border: `1px solid ${t.colors.borderLight}`, fontSize: 10, color: t.colors.text }}>
                      {opt.description}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent"
                           style={{ borderTopColor: t.colors.borderLight }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {intensity && intensityOptions[intensity] && (
          <p style={{ marginTop: 6, fontSize: 11, color: t.colors.textMuted }}>
            <span style={{ color: t.colors.text, fontWeight: 500 }}>{intensityOptions[intensity].label}</span>
            {' -- '}{intensityOptions[intensity].description}
          </p>
        )}
      </div>

      {/* Per-target count */}
      <div>
        <div style={{ fontSize: 11, color: t.colors.textMuted, marginBottom: 4 }}>타겟당 증강 수</div>
        <div className="flex items-center gap-2">
          <input
            type="range" min={50} max={2000} step={50} value={nPerTarget}
            onChange={(e) => onNPerTargetChange(Number(e.target.value))}
            className="flex-1"
          />
          <input
            type="number" min={10} max={5000} value={nPerTarget}
            onChange={(e) => onNPerTargetChange(Math.max(10, Math.min(5000, Number(e.target.value))))}
            style={{ ...t.input, width: 56, textAlign: 'center' }}
          />
          <span style={{ fontSize: 10, color: t.colors.textDim }}>/ target</span>
        </div>
      </div>
    </div>
  )
}
