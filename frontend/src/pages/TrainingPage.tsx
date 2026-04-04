import { useEffect, useRef, useState } from 'react'
import { Lock, Check, Square, AlertCircle, CheckCircle2, Loader2, Info, Upload, X, FolderOpen } from 'lucide-react'
import { api } from '../api/httpClient'
import AugmentationControl from '../components/AugmentationControl/AugmentationControl'
import { useTheme } from '../hooks/useTheme'
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

// Default metadata when backend is offline
const DEFAULT_MANDATORY: PreprocessStep[] = [
  { id: 'to_rgb', label: 'RGB 변환', description: 'BGR -> RGB 색공간 변환' },
  { id: 'resize', label: '크기 조정 (224x224)', description: '모델 입력 크기에 맞게 리사이즈' },
  { id: 'normalize', label: '정규화 (ImageNet)', description: 'ImageNet mean/std로 정규화' },
]

const DEFAULT_OPTIONAL: Record<string, OptionalMeta> = {
  clahe: { label: 'CLAHE (대비 향상)', description: '조명이 균일하지 않은 환경에서 대비를 개선합니다', default: false },
  denoise: { label: '노이즈 제거', description: '카메라 노이즈가 심한 환경에서 사용합니다', default: false },
  sharpen: { label: '선명화', description: '초점이 약간 나간 이미지를 보정합니다', default: false },
  pad_square: { label: '정사각 패딩', description: '비율 유지를 위해 짧은 변에 패딩을 추가합니다', default: true },
}

const DEFAULT_INTENSITY: Record<AugIntensity, IntensityOption> = {
  weak: { label: '약', description: '원본에 가까운 최소 변형' },
  medium_weak: { label: '중약', description: '가벼운 회전과 밝기 변화' },
  medium: { label: '중', description: '적당한 기하학적 변형 + 색상 변환' },
  medium_strong: { label: '중강', description: '눈에 띄는 변형, 다양한 조건 시뮬레이션' },
  strong: { label: '강', description: '강한 왜곡과 블러, 극한 조건 대비' },
  extreme: { label: '최강', description: '최대 변형, 극단적 노이즈 및 왜곡 포함' },
}

export default function TrainingPage() {
  const t = useTheme()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [offline, setOffline] = useState(false)

  const [mandatorySteps, setMandatorySteps] = useState<PreprocessStep[]>(DEFAULT_MANDATORY)
  const [optionalMeta, setOptionalMeta] = useState<Record<string, OptionalMeta>>(DEFAULT_OPTIONAL)
  const [intensityOptions, setIntensityOptions] = useState<Record<AugIntensity, IntensityOption>>(DEFAULT_INTENSITY)

  const [numTargets, setNumTargets] = useState(4)
  const [uploadTarget, setUploadTarget] = useState(1)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ saved: number; skipped: string[] } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadStats, setUploadStats] = useState<Record<string, number>>({})
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [optionalSteps, setOptionalSteps] = useState<string[]>(['pad_square'])
  const [intensity, setIntensity] = useState<AugIntensity>('medium')
  const [nPerTarget, setNPerTarget] = useState(500)
  const [preprocessExtra, setPreprocessExtra] = useState<Omit<PreprocessConfigState, 'input_size' | 'optional_steps'>>({
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
        if (meta.preprocess.mandatory?.length) setMandatorySteps(meta.preprocess.mandatory)
        if (meta.preprocess.optional_available) setOptionalMeta(meta.preprocess.optional_available)
        if (meta.augmentation.intensity_options) setIntensityOptions(meta.augmentation.intensity_options)
        setOffline(false)
        try {
          const statsRes = await api.getUploadStats()
          setUploadStats(statsRes.data)
        } catch { /* ignore */ }
      } catch {
        setOffline(true)
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
        preprocess: { input_size: [224, 224], optional_steps: optionalSteps, ...preprocessExtra },
        augmentation: { intensity, n_per_target: nPerTarget },
      })
      setStatus('saved')
      setStatusMsg('설정 저장 완료')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setStatusMsg('저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFiles.length) return
    setUploading(true)
    setUploadResult(null)
    setUploadError(null)
    try {
      const res = await api.uploadTrainingImages(uploadTarget, uploadFiles)
      setUploadResult({ saved: res.data.saved, skipped: res.data.skipped })
      setUploadFiles([])
      const statsRes = await api.getUploadStats()
      setUploadStats(statsRes.data)
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  const handleFilePick = (fl: FileList | null) => {
    if (!fl) return
    setUploadFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      const added = Array.from(fl).filter(f => !existing.has(f.name))
      return [...prev, ...added]
    })
  }

  const toggleOptional = (id: string, checked: boolean) => {
    setOptionalSteps(prev => checked ? [...prev, id] : prev.filter(s => s !== id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2" style={{ color: t.colors.textMuted }}>
        <Loader2 size={14} className="animate-spin" />
        <span style={{ fontSize: 11 }}>로드 중</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-3 max-w-3xl">
        {/* Header */}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: t.colors.textHeading }}>학습 설정</h2>
          <p style={{ fontSize: 11, color: t.colors.textMuted, marginTop: 2 }}>
            타겟 수, 전처리, 데이터 증강 방식을 설정합니다.
          </p>
        </div>

        {offline && (
          <div className="flex items-center gap-2 rounded px-3 py-2" style={{
            background: t.colors.warning + '15',
            border: `1px solid ${t.colors.warning}30`,
            fontSize: 11,
            color: t.colors.warning,
          }}>
            <AlertCircle size={13} />
            백엔드 미연결 -- 기본값으로 표시 중. 서버 시작 후 새로고침하세요.
          </div>
        )}

        {/* Target count */}
        <Section t={t} title="타겟 수">
          <div className="flex items-center gap-3">
            <input
              type="range" min={1} max={20} value={numTargets}
              onChange={(e) => setNumTargets(Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number" min={1} max={20} value={numTargets}
              onChange={(e) => setNumTargets(Math.max(1, Math.min(20, Number(e.target.value))))}
              style={{ ...t.input, width: 44, textAlign: 'center' }}
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {Array.from({ length: numTargets }, (_, i) => (
              <span key={i} style={{
                ...t.badge('info'),
                fontFamily: 'monospace',
              }}>T{i + 1}</span>
            ))}
          </div>
        </Section>

        {/* Data Upload */}
        <Section t={t} title="학습 데이터 업로드">
          <div style={{ fontSize: 11, color: t.colors.textMuted, marginBottom: 8 }}>
            각 타겟별 정상 이미지를 업로드하세요. <code style={{ background: t.colors.bgInput, padding: '0 3px', borderRadius: 2, fontSize: 10 }}>artifacts/data/raw/T{'{n}'}/</code> 에 저장됩니다.
          </div>

          {/* Target selector */}
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontSize: 11, color: t.colors.textMuted }}>타겟</span>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: numTargets }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setUploadTarget(n)}
                  style={{
                    ...t.badge('info'),
                    cursor: 'pointer',
                    background: uploadTarget === n ? t.colors.accent + '25' : t.colors.bgInput,
                    color: uploadTarget === n ? t.colors.accent : t.colors.textMuted,
                    border: `1px solid ${uploadTarget === n ? t.colors.accent : t.colors.border}`,
                    fontFamily: 'monospace',
                  }}
                >
                  T{n}
                  {uploadStats[`T${n}`] !== undefined && (
                    <span style={{ marginLeft: 3, color: uploadTarget === n ? t.colors.accent : t.colors.textDim }}>
                      ({uploadStats[`T${n}`]})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFilePick(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
            style={{
              height: 80,
              border: `2px dashed ${dragOver ? t.colors.accent : t.colors.border}`,
              background: dragOver ? t.colors.accent + '10' : t.colors.bgInput,
              color: dragOver ? t.colors.accent : t.colors.textDim,
            }}
          >
            <FolderOpen size={20} />
            <span style={{ fontSize: 11 }}>클릭하거나 파일을 드래그하세요 (jpg / png)</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/bmp,image/webp"
            style={{ display: 'none' }}
            onChange={e => handleFilePick(e.target.files)}
          />

          {/* File list */}
          {uploadFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {uploadFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1 rounded px-1.5 py-0.5"
                     style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}`, fontSize: 10, color: t.colors.textMuted }}>
                  {f.name}
                  <X size={9} style={{ cursor: 'pointer', color: t.colors.textDim }}
                    onClick={() => setUploadFiles(prev => prev.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
          )}

          {/* Upload button */}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleUpload}
              disabled={uploading || uploadFiles.length === 0}
              style={t.btnPrimary}
            >
              {uploading
                ? <><Loader2 size={11} className="animate-spin" /> 업로드 중</>
                : <><Upload size={11} /> T{uploadTarget}에 {uploadFiles.length}개 업로드</>
              }
            </button>
            {uploadFiles.length > 0 && (
              <button onClick={() => setUploadFiles([])} style={t.btnSecondary}>
                초기화
              </button>
            )}
          </div>

          {uploadResult && (
            <div className="flex items-center gap-1 mt-1" style={{ fontSize: 11, color: t.colors.success }}>
              <CheckCircle2 size={12} />
              {uploadResult.saved}개 저장됨
              {uploadResult.skipped.length > 0 && (
                <span style={{ color: t.colors.warning }}> (건너뜀: {uploadResult.skipped.join(', ')})</span>
              )}
            </div>
          )}
          {uploadError && (
            <div className="flex items-center gap-1 mt-1" style={{ fontSize: 11, color: t.colors.danger }}>
              <AlertCircle size={12} />{uploadError}
            </div>
          )}
        </Section>

        {/* Preprocessing */}
        <Section t={t} title="전처리">
          <div style={{ fontSize: 10, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            필수 (자동 적용)
          </div>
          <div className="space-y-1 mb-3">
            {mandatorySteps.map(step => (
              <MandatoryItem key={step.id} step={step} t={t} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            선택 (환경에 따라)
          </div>
          <div className="space-y-1">
            {Object.entries(optionalMeta).map(([id, meta]) => (
              <OptionalItem
                key={id}
                id={id}
                meta={meta}
                checked={optionalSteps.includes(id)}
                onChange={(c) => toggleOptional(id, c)}
                t={t}
              />
            ))}
          </div>

          {/* Detail sliders */}
          {optionalSteps.includes('clahe') && (
            <SliderRow t={t} label="CLAHE Clip Limit" min={0.5} max={10} step={0.5}
              value={preprocessExtra.clahe_clip_limit}
              onChange={(v) => setPreprocessExtra(p => ({ ...p, clahe_clip_limit: v }))}
              format={(v) => v.toString()}
            />
          )}
          {optionalSteps.includes('denoise') && (
            <SliderRow t={t} label="Denoise (h)" min={1} max={50} step={1}
              value={preprocessExtra.denoise_h}
              onChange={(v) => setPreprocessExtra(p => ({ ...p, denoise_h: v }))}
              format={(v) => v.toString()}
            />
          )}
          {optionalSteps.includes('sharpen') && (
            <SliderRow t={t} label="Sharpen" min={0} max={2} step={0.1}
              value={preprocessExtra.sharpen_amount}
              onChange={(v) => setPreprocessExtra(p => ({ ...p, sharpen_amount: v }))}
              format={(v) => v.toFixed(1)}
            />
          )}
        </Section>

        {/* Augmentation */}
        <Section t={t} title="데이터 증강">
          <AugmentationControl
            intensity={intensity}
            nPerTarget={nPerTarget}
            intensityOptions={intensityOptions}
            onIntensityChange={setIntensity}
            onNPerTargetChange={setNPerTarget}
          />
        </Section>

        {/* Save */}
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving} style={t.btnPrimary}>
            {saving ? <><Loader2 size={11} className="animate-spin" /> 저장 중</> : '설정 저장'}
          </button>
          {status === 'saved' && (
            <span className="flex items-center gap-1" style={{ fontSize: 11, color: t.colors.success }}>
              <CheckCircle2 size={12} />{statusMsg}
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1" style={{ fontSize: 11, color: t.colors.danger }}>
              <AlertCircle size={12} />{statusMsg}
            </span>
          )}
        </div>

        {/* Next steps */}
        <div className="rounded p-3" style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            다음 단계
          </div>
          <ol style={{ fontSize: 11, color: t.colors.textMuted, listStyle: 'decimal', paddingLeft: 16 }} className="space-y-0.5">
            <li>위 "학습 데이터 업로드"에서 T1~T{numTargets} 이미지 업로드</li>
            <li>설정 저장 후 터미널에서 학습 실행</li>
            <li>학습 완료 후 모델 비교 탭에서 벤치마크 실행</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function Section({ t, title, children }: { t: ReturnType<typeof useTheme>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.colors.textHeading, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

function MandatoryItem({ step, t }: { step: PreprocessStep; t: ReturnType<typeof useTheme> }) {
  const [tip, setTip] = useState(false)
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded" style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
      <div className="flex items-center gap-1.5">
        <Lock size={11} style={{ color: t.colors.accent }} />
        <span style={{ fontSize: 11, color: t.colors.text }}>{step.label}</span>
        <div className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
          <Info size={10} style={{ color: t.colors.textDim, cursor: 'pointer' }} />
          {tip && (
            <div className="absolute z-50 bottom-full left-0 mb-1 w-48 rounded px-2 py-1.5 pointer-events-none shadow-lg"
                 style={{ background: t.colors.bgActivityBar, border: `1px solid ${t.colors.borderLight}`, fontSize: 10, color: t.colors.text }}>
              {step.description}
            </div>
          )}
        </div>
      </div>
      <span style={t.badge('info')}>필수</span>
    </div>
  )
}

function OptionalItem({ id, meta, checked, onChange, t }: {
  id: string; meta: OptionalMeta; checked: boolean; onChange: (c: boolean) => void; t: ReturnType<typeof useTheme>
}) {
  const [tip, setTip] = useState(false)
  return (
    <div
      className="flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors"
      style={{
        background: checked ? t.colors.accent + '0d' : t.colors.bgInput,
        border: `1px solid ${checked ? t.colors.accent + '40' : t.colors.border}`,
      }}
      onClick={() => onChange(!checked)}
    >
      <div className="flex items-center gap-1.5">
        {checked ? <Check size={12} style={{ color: t.colors.accent }} /> : <Square size={12} style={{ color: t.colors.textDim }} />}
        <span style={{ fontSize: 11, color: checked ? t.colors.text : t.colors.textMuted }}>{meta.label}</span>
        <div className="relative" onClick={(e) => e.stopPropagation()} onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
          <Info size={10} style={{ color: t.colors.textDim, cursor: 'pointer' }} />
          {tip && (
            <div className="absolute z-50 bottom-full left-0 mb-1 w-48 rounded px-2 py-1.5 pointer-events-none shadow-lg"
                 style={{ background: t.colors.bgActivityBar, border: `1px solid ${t.colors.borderLight}`, fontSize: 10, color: t.colors.text }}>
              {meta.description}
            </div>
          )}
        </div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: checked ? t.colors.accent : t.colors.textDim }}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  )
}

function SliderRow({ t, label, min, max, step, value, onChange, format }: {
  t: ReturnType<typeof useTheme>; label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; format: (v: number) => string
}) {
  return (
    <div className="mt-2 pt-2" style={t.divider}>
      <div className="flex items-center gap-3">
        <span style={{ fontSize: 11, color: t.colors.textMuted, width: 100 }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.colors.text, width: 32, textAlign: 'right' }}>
          {format(value)}
        </span>
      </div>
    </div>
  )
}
