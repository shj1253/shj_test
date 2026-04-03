/**
 * 학습 설정 페이지
 * - 타겟 수 설정
 * - 전처리 설정 (필수/선택 구분)
 * - 증강 설정 (강도 + 수량)
 * - 설정 저장 + 학습 실행
 */
import { useEffect, useState } from 'react'
import { Lock, CheckSquare, Square, AlertCircle, CheckCircle, Loader2, Info } from 'lucide-react'
import { api } from '../api/httpClient'
import AugmentationControl from '../components/AugmentationControl/AugmentationControl'
import type {
  AugIntensity,
  IntensityOption,
  PreprocessConfigState,
  PreprocessStep,
  TrainingConfig,
} from '../types'

// ── 로컬 상태 타입 ─────────────────────────────────────────────────────────

interface OptionalMeta {
  label: string
  description: string
  default: boolean
}

// ── 섹션 카드 ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <h3 className="text-base font-semibold text-gray-100 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ── 필수 전처리 항목 (잠금) ───────────────────────────────────────────────

function MandatoryStep({ label, description }: PreprocessStep) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div className="flex items-center justify-between py-2 px-3
                    bg-gray-800 border border-gray-700 rounded-lg">
      <div className="flex items-center gap-2">
        <Lock size={13} className="text-blue-400 flex-shrink-0" />
        <span className="text-sm text-gray-200">{label}</span>
        <div
          className="relative cursor-pointer"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <Info size={13} className="text-gray-500 hover:text-gray-300" />
          {showTip && (
            <div className="absolute z-50 bottom-full left-0 mb-1 w-56
                            bg-gray-900 border border-gray-600 rounded-lg
                            px-3 py-2 text-xs text-gray-300 shadow-xl pointer-events-none">
              {description}
            </div>
          )}
        </div>
      </div>
      <span className="text-xs text-blue-400 font-medium">필수</span>
    </div>
  )
}

// ── 선택 전처리 항목 ──────────────────────────────────────────────────────

function OptionalStep({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div
      className={`flex items-center justify-between py-2 px-3 rounded-lg border cursor-pointer
                  transition-colors duration-150
                  ${checked
                    ? 'bg-blue-900/30 border-blue-600'
                    : 'bg-gray-800 border-gray-700 hover:border-gray-500'}`}
      onClick={() => onChange(!checked)}
    >
      <div className="flex items-center gap-2">
        {checked
          ? <CheckSquare size={15} className="text-blue-400 flex-shrink-0" />
          : <Square size={15} className="text-gray-500 flex-shrink-0" />
        }
        <span className={`text-sm ${checked ? 'text-gray-100' : 'text-gray-400'}`}>
          {label}
        </span>
        <div
          className="relative cursor-default"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <Info size={13} className="text-gray-500 hover:text-gray-300" />
          {showTip && (
            <div className="absolute z-50 bottom-full left-0 mb-1 w-56
                            bg-gray-900 border border-gray-600 rounded-lg
                            px-3 py-2 text-xs text-gray-300 shadow-xl pointer-events-none">
              {description}
            </div>
          )}
        </div>
      </div>
      <span className={`text-xs font-medium ${checked ? 'text-blue-400' : 'text-gray-600'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  // 메타데이터 (백엔드에서 로드)
  const [mandatorySteps, setMandatorySteps] = useState<PreprocessStep[]>([])
  const [optionalMeta, setOptionalMeta] = useState<Record<string, OptionalMeta>>({})
  const [intensityOptions, setIntensityOptions] = useState<Record<AugIntensity, IntensityOption>>(
    {} as Record<AugIntensity, IntensityOption>
  )

  // 편집 중인 설정
  const [numTargets, setNumTargets] = useState(4)
  const [optionalSteps, setOptionalSteps] = useState<string[]>(['pad_square'])
  const [intensity, setIntensity] = useState<AugIntensity>('medium')
  const [nPerTarget, setNPerTarget] = useState(500)
  const [preprocessExtra, setPreprocessExtra] = useState<Omit<PreprocessConfigState,
    'input_size' | 'optional_steps'>>({
    clahe_clip_limit: 2.0,
    clahe_tile_grid: [8, 8],
    denoise_h: 10,
    sharpen_amount: 1.0,
  })

  // ── 초기 데이터 로드 ────────────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getTrainingConfig()
        const { current, meta } = res.data

        setNumTargets(current.num_targets)
        setOptionalSteps(current.preprocess.optional_steps ?? [])
        setIntensity(current.augmentation.intensity)
        setNPerTarget(current.augmentation.n_per_target)
        setPreprocessExtra({
          clahe_clip_limit: current.preprocess.clahe_clip_limit,
          clahe_tile_grid: current.preprocess.clahe_tile_grid,
          denoise_h: current.preprocess.denoise_h,
          sharpen_amount: current.preprocess.sharpen_amount,
        })

        setMandatorySteps(meta.preprocess.mandatory ?? [])
        setOptionalMeta(meta.preprocess.optional_available ?? {})
        setIntensityOptions(meta.augmentation.intensity_options ?? {})
      } catch {
        setStatus('error')
        setStatusMsg('설정을 불러오지 못했습니다. 백엔드 서버를 확인해주세요.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── 저장 ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setStatus('idle')
    try {
      await api.updateTrainingConfig({
        num_targets: numTargets,
        preprocess: {
          input_size: [224, 224],
          optional_steps: optionalSteps,
          ...preprocessExtra,
        },
        augmentation: {
          intensity,
          n_per_target: nPerTarget,
        },
      })
      setStatus('saved')
      setStatusMsg('설정이 저장되었습니다.')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setStatusMsg('저장 실패. 입력값을 확인해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const toggleOptional = (id: string, checked: boolean) => {
    setOptionalSteps(prev =>
      checked ? [...prev, id] : prev.filter(s => s !== id)
    )
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
        <Loader2 size={20} className="animate-spin" />
        설정 불러오는 중...
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-100">학습 설정</h2>
        <p className="text-sm text-gray-400 mt-1">
          이미지 배치 전 타겟 수와 전처리·증강 방식을 설정합니다.
        </p>
      </div>

      {/* ── 1. 타겟 수 ─────────────────────────────────────────────────── */}
      <SectionCard title="🎯 타겟 수">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-sm text-gray-400 block mb-1">
              검출할 타겟 이미지 수
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={20}
                value={numTargets}
                onChange={(e) => setNumTargets(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <input
                type="number"
                min={1}
                max={20}
                value={numTargets}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(20, Number(e.target.value)))
                  setNumTargets(v)
                }}
                className="w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded
                           text-sm text-center text-gray-100 focus:border-blue-500 outline-none"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">개</span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: numTargets }, (_, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-blue-900/50 border border-blue-700
                         rounded text-xs text-blue-300 font-medium"
            >
              T{i + 1}
            </span>
          ))}
          <span className="px-2 py-0.5 text-xs text-gray-500">
            → 순서대로 검출
          </span>
        </div>
      </SectionCard>

      {/* ── 2. 전처리 ───────────────────────────────────────────────────── */}
      <SectionCard title="⚙️ 전처리 설정">
        {/* 필수 */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={13} className="text-blue-400" />
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
              필수 전처리 — 항상 적용됨
            </span>
          </div>
          <div className="space-y-1.5">
            {mandatorySteps.map((step) => (
              <MandatoryStep key={step.id} {...step} />
            ))}
          </div>
        </div>

        {/* 선택 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckSquare size={13} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              선택 전처리 — 현장 환경에 맞게 선택
            </span>
          </div>
          <div className="space-y-1.5">
            {Object.entries(optionalMeta).map(([id, meta]) => (
              <OptionalStep
                key={id}
                id={id}
                label={meta.label}
                description={meta.description}
                checked={optionalSteps.includes(id)}
                onChange={(checked) => toggleOptional(id, checked)}
              />
            ))}
          </div>
        </div>

        {/* 선택 전처리 세부 설정 */}
        {optionalSteps.includes('clahe') && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-400 mb-2">CLAHE 세부 설정</p>
            <div className="flex items-center gap-4">
              <label className="text-xs text-gray-500 w-24">Clip Limit</label>
              <input
                type="range" min={0.5} max={10} step={0.5}
                value={preprocessExtra.clahe_clip_limit}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, clahe_clip_limit: Number(e.target.value)
                }))}
                className="flex-1 accent-teal-500"
              />
              <span className="text-xs text-gray-300 w-8 text-right">
                {preprocessExtra.clahe_clip_limit}
              </span>
            </div>
          </div>
        )}
        {optionalSteps.includes('denoise') && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-400 mb-2">노이즈 제거 강도</p>
            <div className="flex items-center gap-4">
              <label className="text-xs text-gray-500 w-24">강도 (h)</label>
              <input
                type="range" min={1} max={50} step={1}
                value={preprocessExtra.denoise_h}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, denoise_h: Number(e.target.value)
                }))}
                className="flex-1 accent-teal-500"
              />
              <span className="text-xs text-gray-300 w-8 text-right">
                {preprocessExtra.denoise_h}
              </span>
            </div>
          </div>
        )}
        {optionalSteps.includes('sharpen') && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-400 mb-2">선명화 강도</p>
            <div className="flex items-center gap-4">
              <label className="text-xs text-gray-500 w-24">강도</label>
              <input
                type="range" min={0} max={2} step={0.1}
                value={preprocessExtra.sharpen_amount}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, sharpen_amount: Number(e.target.value)
                }))}
                className="flex-1 accent-teal-500"
              />
              <span className="text-xs text-gray-300 w-8 text-right">
                {preprocessExtra.sharpen_amount.toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── 3. 증강 ─────────────────────────────────────────────────────── */}
      <SectionCard title="🎲 데이터 증강 설정">
        {Object.keys(intensityOptions).length > 0 ? (
          <AugmentationControl
            intensity={intensity}
            nPerTarget={nPerTarget}
            intensityOptions={intensityOptions}
            onIntensityChange={setIntensity}
            onNPerTargetChange={setNPerTarget}
          />
        ) : (
          <p className="text-sm text-gray-500">강도 옵션 로드 중...</p>
        )}
      </SectionCard>

      {/* ── 저장 버튼 + 상태 ────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900
                     text-white rounded-lg text-sm font-medium transition-colors
                     flex items-center gap-2"
        >
          {saving
            ? <><Loader2 size={14} className="animate-spin" /> 저장 중...</>
            : '설정 저장'}
        </button>

        {status === 'saved' && (
          <div className="flex items-center gap-1.5 text-green-400 text-sm">
            <CheckCircle size={15} />
            {statusMsg}
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center gap-1.5 text-red-400 text-sm">
            <AlertCircle size={15} />
            {statusMsg}
          </div>
        )}
      </div>

      {/* ── 다음 단계 안내 ────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 mb-2">📋 다음 단계</p>
        <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
          <li>
            <code className="bg-gray-800 px-1 rounded">artifacts/data/raw/</code>에
            T1 ~ T{numTargets} 이미지 파일 배치
          </li>
          <li>
            터미널에서 학습 실행:
            <code className="ml-1 bg-gray-800 px-1 rounded">
              python training/train_pipeline.py --target-dir artifacts/data/raw
              --gate-type both --intensity {intensity} --n-aug {nPerTarget}
            </code>
          </li>
          <li>학습 완료 후 서버 재시작 또는 <strong>모델 비교</strong> 탭에서 A/B 벤치마크 실행</li>
        </ol>
      </div>
    </div>
  )
}
