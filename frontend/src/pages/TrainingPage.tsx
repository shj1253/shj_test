import { useEffect, useState } from 'react'
import { Lock, Check, Square, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'
import { api } from '../api/httpClient'
import AugmentationControl from '../components/AugmentationControl/AugmentationControl'
import type {
  AugIntensity,
  IntensityOption,
  PreprocessConfigState,
  PreprocessStep,
} from '../types'

interface OptionalMeta {
  label: string
  description: string
  default: boolean
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function MandatoryStep({ label, description }: PreprocessStep) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div className="flex items-center justify-between py-2 px-3
                    bg-[#0f172a] border border-[#1e293b] rounded">
      <div className="flex items-center gap-2">
        <Lock size={12} className="text-blue-400 flex-shrink-0" />
        <span className="text-xs text-slate-300">{label}</span>
        <div
          className="relative cursor-pointer"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <Info size={11} className="text-slate-600 hover:text-slate-400" />
          {showTip && (
            <div className="absolute z-50 bottom-full left-0 mb-1.5 w-52
                            bg-[#1e293b] border border-[#334155] rounded
                            px-3 py-2 text-[11px] text-slate-300 shadow-lg pointer-events-none">
              {description}
            </div>
          )}
        </div>
      </div>
      <span className="badge badge-info">필수</span>
    </div>
  )
}

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
      className={`flex items-center justify-between py-2 px-3 rounded border cursor-pointer
                  transition-colors duration-150
                  ${checked
                    ? 'bg-blue-500/5 border-blue-500/30'
                    : 'bg-[#0f172a] border-[#1e293b] hover:border-[#334155]'}`}
      onClick={() => onChange(!checked)}
    >
      <div className="flex items-center gap-2">
        {checked
          ? <Check size={13} className="text-blue-400 flex-shrink-0" />
          : <Square size={13} className="text-slate-600 flex-shrink-0" />
        }
        <span className={`text-xs ${checked ? 'text-slate-200' : 'text-slate-500'}`}>
          {label}
        </span>
        <div
          className="relative cursor-default"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          <Info size={11} className="text-slate-600 hover:text-slate-400" />
          {showTip && (
            <div className="absolute z-50 bottom-full left-0 mb-1.5 w-52
                            bg-[#1e293b] border border-[#334155] rounded
                            px-3 py-2 text-[11px] text-slate-300 shadow-lg pointer-events-none">
              {description}
            </div>
          )}
        </div>
      </div>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${
        checked ? 'text-blue-400' : 'text-slate-600'
      }`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

export default function TrainingPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')

  const [mandatorySteps, setMandatorySteps] = useState<PreprocessStep[]>([])
  const [optionalMeta, setOptionalMeta] = useState<Record<string, OptionalMeta>>({})
  const [intensityOptions, setIntensityOptions] = useState<Record<AugIntensity, IntensityOption>>(
    {} as Record<AugIntensity, IntensityOption>
  )

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
        setStatusMsg('설정을 불러오지 못했습니다. 백엔드 서버를 확인하세요.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
      setStatusMsg('저장 실패. 입력값을 확인하세요.')
    } finally {
      setSaving(false)
    }
  }

  const toggleOptional = (id: string, checked: boolean) => {
    setOptionalSteps(prev =>
      checked ? [...prev, id] : prev.filter(s => s !== id)
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">설정 로드 중</span>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-2xl mx-auto space-y-4">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-slate-100">학습 설정</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          타겟 수, 전처리, 데이터 증강 방식을 구성합니다.
        </p>
      </div>

      {/* 1. 타겟 수 */}
      <SectionCard title="타겟 수">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-[11px] text-slate-500 block mb-1.5">
              검출할 타겟 이미지 수
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={20}
                value={numTargets}
                onChange={(e) => setNumTargets(Number(e.target.value))}
                className="flex-1"
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
                className="input w-14 text-center text-xs"
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {Array.from({ length: numTargets }, (_, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20
                         rounded text-[10px] text-blue-400 font-mono font-medium"
            >
              T{i + 1}
            </span>
          ))}
          <span className="px-2 py-0.5 text-[10px] text-slate-600 flex items-center">
            순서 검출
          </span>
        </div>
      </SectionCard>

      {/* 2. 전처리 */}
      <SectionCard title="전처리 설정">
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Lock size={11} className="text-blue-400" />
            <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
              필수 전처리
            </span>
          </div>
          <div className="space-y-1.5">
            {mandatorySteps.map((step) => (
              <MandatoryStep key={step.id} {...step} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              선택 전처리
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

        {optionalSteps.includes('clahe') && (
          <div className="mt-3 pt-3 divider">
            <p className="text-[11px] text-slate-500 mb-2">CLAHE 세부 설정</p>
            <div className="flex items-center gap-4">
              <label className="text-[11px] text-slate-600 w-20">Clip Limit</label>
              <input
                type="range" min={0.5} max={10} step={0.5}
                value={preprocessExtra.clahe_clip_limit}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, clahe_clip_limit: Number(e.target.value)
                }))}
                className="flex-1"
              />
              <span className="text-[11px] text-slate-400 font-mono w-8 text-right">
                {preprocessExtra.clahe_clip_limit}
              </span>
            </div>
          </div>
        )}
        {optionalSteps.includes('denoise') && (
          <div className="mt-3 pt-3 divider">
            <p className="text-[11px] text-slate-500 mb-2">노이즈 제거 강도</p>
            <div className="flex items-center gap-4">
              <label className="text-[11px] text-slate-600 w-20">강도 (h)</label>
              <input
                type="range" min={1} max={50} step={1}
                value={preprocessExtra.denoise_h}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, denoise_h: Number(e.target.value)
                }))}
                className="flex-1"
              />
              <span className="text-[11px] text-slate-400 font-mono w-8 text-right">
                {preprocessExtra.denoise_h}
              </span>
            </div>
          </div>
        )}
        {optionalSteps.includes('sharpen') && (
          <div className="mt-3 pt-3 divider">
            <p className="text-[11px] text-slate-500 mb-2">선명화 강도</p>
            <div className="flex items-center gap-4">
              <label className="text-[11px] text-slate-600 w-20">강도</label>
              <input
                type="range" min={0} max={2} step={0.1}
                value={preprocessExtra.sharpen_amount}
                onChange={(e) => setPreprocessExtra(p => ({
                  ...p, sharpen_amount: Number(e.target.value)
                }))}
                className="flex-1"
              />
              <span className="text-[11px] text-slate-400 font-mono w-8 text-right">
                {preprocessExtra.sharpen_amount.toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* 3. 증강 */}
      <SectionCard title="데이터 증강">
        {Object.keys(intensityOptions).length > 0 ? (
          <AugmentationControl
            intensity={intensity}
            nPerTarget={nPerTarget}
            intensityOptions={intensityOptions}
            onIntensityChange={setIntensity}
            onNPerTargetChange={setNPerTarget}
          />
        ) : (
          <p className="text-xs text-slate-600">강도 옵션 로드 중...</p>
        )}
      </SectionCard>

      {/* 저장 */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-6 py-2"
        >
          {saving
            ? <><Loader2 size={12} className="animate-spin" /> 저장 중</>
            : '설정 저장'}
        </button>

        {status === 'saved' && (
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
            <CheckCircle2 size={13} />
            {statusMsg}
          </div>
        )}
        {status === 'error' && (
          <div className="flex items-center gap-1.5 text-red-400 text-xs">
            <AlertCircle size={13} />
            {statusMsg}
          </div>
        )}
      </div>

      {/* 다음 단계 */}
      <div className="panel p-4">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">다음 단계</p>
        <ol className="text-[11px] text-slate-500 space-y-1 list-decimal list-inside">
          <li>
            <code className="bg-[#0f172a] px-1 rounded text-slate-400">artifacts/data/raw/</code>에
            T1 ~ T{numTargets} 이미지 배치
          </li>
          <li>
            터미널에서 학습 실행:
            <code className="ml-1 bg-[#0f172a] px-1 rounded text-slate-400">
              python training/train_pipeline.py --target-dir artifacts/data/raw
              --gate-type both --intensity {intensity} --n-aug {nPerTarget}
            </code>
          </li>
          <li>학습 완료 후 서버 재시작 또는 <span className="text-slate-300">모델 비교</span> 탭에서 벤치마크 실행</li>
        </ol>
      </div>
    </div>
  )
}
