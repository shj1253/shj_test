/**
 * 증강 강도 선택기
 * - 6단계 버튼 (약 / 중약 / 중 / 중강 / 강 / 최강)
 * - 각 버튼 우측 ⓘ 아이콘에 마우스 오버/클릭 시 설명 툴팁
 * - 타겟당 증강 수 입력
 */
import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import type { AugIntensity, IntensityOption } from '../../types'

const INTENSITY_ORDER: AugIntensity[] = [
  'weak', 'medium_weak', 'medium', 'medium_strong', 'strong', 'extreme',
]

const INTENSITY_COLORS: Record<AugIntensity, string> = {
  weak:          'bg-sky-600   hover:bg-sky-500   border-sky-400',
  medium_weak:   'bg-teal-600  hover:bg-teal-500  border-teal-400',
  medium:        'bg-green-600 hover:bg-green-500 border-green-400',
  medium_strong: 'bg-yellow-600 hover:bg-yellow-500 border-yellow-400',
  strong:        'bg-orange-600 hover:bg-orange-500 border-orange-400',
  extreme:       'bg-red-700   hover:bg-red-600   border-red-400',
}

const INTENSITY_COLORS_ACTIVE: Record<AugIntensity, string> = {
  weak:          'bg-sky-500   border-sky-300   ring-2 ring-sky-300',
  medium_weak:   'bg-teal-500  border-teal-300  ring-2 ring-teal-300',
  medium:        'bg-green-500 border-green-300 ring-2 ring-green-300',
  medium_strong: 'bg-yellow-500 border-yellow-300 ring-2 ring-yellow-300',
  strong:        'bg-orange-500 border-orange-300 ring-2 ring-orange-300',
  extreme:       'bg-red-600   border-red-300   ring-2 ring-red-300',
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
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-52
                    bg-gray-900 border border-gray-600 rounded-lg px-3 py-2
                    text-xs text-gray-200 shadow-xl pointer-events-none">
      {text}
      {/* 아래 삼각형 */}
      <div className="absolute top-full left-1/2 -translate-x-1/2
                      border-4 border-transparent border-t-gray-600" />
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
        <p className="text-sm text-gray-400 mb-2">증강 강도</p>
        <div className="flex flex-wrap gap-2">
          {INTENSITY_ORDER.map((key) => {
            const opt = intensityOptions[key]
            const isActive = intensity === key
            const colorClass = isActive
              ? INTENSITY_COLORS_ACTIVE[key]
              : INTENSITY_COLORS[key]

            return (
              <div key={key} className="relative flex items-center">
                {/* 강도 버튼 */}
                <button
                  onClick={() => onIntensityChange(key)}
                  className={`px-3 py-1.5 rounded-l-lg border text-sm font-medium
                              text-white transition-all duration-150 ${colorClass}`}
                >
                  {opt?.label ?? key}
                </button>

                {/* ⓘ 툴팁 버튼 */}
                <div
                  className={`relative px-1.5 py-1.5 rounded-r-lg border-y border-r
                               cursor-pointer transition-colors duration-150
                               ${isActive
                                 ? `${INTENSITY_COLORS_ACTIVE[key]} border-l-0`
                                 : `${INTENSITY_COLORS[key]} border-l-0 opacity-80`}`}
                  onMouseEnter={() => showTooltip(key)}
                  onMouseLeave={hideTooltip}
                  onClick={() => showTooltip(tooltip === key ? null as any : key)}
                >
                  <Info size={13} className="text-white" />
                  <Tooltip
                    text={opt?.description ?? ''}
                    visible={tooltip === key}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* 선택된 강도 설명 */}
        {intensity && intensityOptions[intensity] && (
          <p className="mt-2 text-xs text-gray-400 italic">
            선택됨: <span className="text-gray-300 not-italic font-medium">
              {intensityOptions[intensity].label}
            </span>{' '}—{' '}
            {intensityOptions[intensity].description}
          </p>
        )}
      </div>

      {/* 타겟당 증강 수 */}
      <div>
        <label className="text-sm text-gray-400 block mb-1">
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
            className="flex-1 accent-blue-500"
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
            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded
                       text-sm text-center text-gray-100 focus:border-blue-500 outline-none"
          />
          <span className="text-xs text-gray-500 whitespace-nowrap">장 / 타겟</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          총 생성 예정:{' '}
          <span className="text-gray-300">
            타겟 수 × {nPerTarget.toLocaleString()} 장
          </span>
        </p>
      </div>
    </div>
  )
}
