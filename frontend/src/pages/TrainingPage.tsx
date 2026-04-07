import { useEffect, useRef, useState, useCallback } from 'react'
import { Lock, Check, Square, AlertCircle, CheckCircle2, Loader2, Info, Upload, X, FolderOpen, Play, RotateCcw, Download } from 'lucide-react'
import { api } from '../api/httpClient'
import AugmentationControl from '../components/AugmentationControl/AugmentationControl'
import { useTheme } from '../hooks/useTheme'
import { useWebSocket } from '../api/wsClient'
import type {
  AugIntensity,
  IntensityOption,
  PreprocessConfigState,
  PreprocessStep,
} from '../types'

type TrainStatus = 'idle' | 'running' | 'completed' | 'error'
interface TrainState {
  status: TrainStatus
  progress: number
  message: string
  result: Record<string, number> | null
}

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

  const [trainState, setTrainState] = useState<TrainState>({
    status: 'idle', progress: 0, message: '', result: null,
  })

  const [wsConnected, setWsConnected] = useState(false)

  const handleTrainMsg = useCallback((data: unknown) => {
    const msg = data as { event: string; status: TrainStatus; progress: number; message: string; result?: Record<string, number> }
    if (msg.event === 'ping') return  // keepalive — 무시
    if (msg.event === 'progress' || msg.event === 'completed' || msg.event === 'error' || msg.event === 'state') {
      setTrainState({
        status: msg.status ?? 'idle',
        progress: msg.progress ?? 0,
        message: msg.message ?? '',
        result: msg.result ?? null,
      })
    }
  }, [])

  useWebSocket('training', handleTrainMsg, (online) => setWsConnected(online))

  // 마운트 시 현재 학습 상태 복원 (새로고침/페이지 재진입 대응)
  useEffect(() => {
    api.getTrainingStatus().then(res => {
      const s = res.data as { status: TrainStatus; progress: number; message: string; result: Record<string, number> | null }
      if (s.status !== 'idle') {
        setTrainState({ status: s.status, progress: s.progress ?? 0, message: s.message ?? '', result: s.result ?? null })
      }
    }).catch(() => {})
  }, [])

  // WS 끊김 시 HTTP 폴링 백업 (3초마다) — Railway 프록시 재연결 중에도 진행률 유지
  useEffect(() => {
    if (wsConnected || trainState.status !== 'running') return
    const iv = setInterval(() => {
      api.getTrainingStatus().then(res => {
        const s = res.data as { status: TrainStatus; progress: number; message: string; result: Record<string, number> | null }
        setTrainState({ status: s.status, progress: s.progress ?? 0, message: s.message ?? '', result: s.result ?? null })
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(iv)
  }, [wsConnected, trainState.status])

  const handleStartTraining = async () => {
    try {
      setTrainState({ status: 'running', progress: 0, message: '학습 시작 요청 중...', result: null })
      await api.startTraining()
    } catch (e: unknown) {
      setTrainState(prev => ({
        ...prev,
        status: 'error',
        message: e instanceof Error ? e.message : '학습 시작 실패',
      }))
    }
  }

  const [resetting, setResetting] = useState(false)
  const handleReset = async (keepImages: boolean) => {
    const msg = keepImages
      ? '학습된 모델과 파생 데이터를 초기화합니다.\n원본 타겟 이미지는 유지됩니다. 계속하시겠습니까?'
      : '학습된 모델과 모든 데이터(원본 이미지 포함)를 초기화합니다.\n계속하시겠습니까?'
    if (!window.confirm(msg)) return
    setResetting(true)
    try {
      await api.resetTraining(keepImages)
      setTrainState({ status: 'idle', progress: 0, message: '', result: null })
      setUploadRefreshKey(k => k + 1)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '초기화 실패')
    } finally {
      setResetting(false)
    }
  }

  const [mandatorySteps, setMandatorySteps] = useState<PreprocessStep[]>(DEFAULT_MANDATORY)
  const [optionalMeta, setOptionalMeta] = useState<Record<string, OptionalMeta>>(DEFAULT_OPTIONAL)
  const [intensityOptions, setIntensityOptions] = useState<Record<AugIntensity, IntensityOption>>(DEFAULT_INTENSITY)

  const [numTargets, setNumTargets] = useState(4)
  const [uploadTarget, setUploadTarget] = useState(1)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadRefreshKey, setUploadRefreshKey] = useState(0)
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
      setUploadRefreshKey(k => k + 1)
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
    <div className="h-full flex overflow-hidden">
      {/* ── 좌측: 설정 패널 ── */}
      <div className="overflow-y-auto flex-shrink-0" style={{ width: 420 }}>
      <div className="p-4 space-y-3">
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

        {/* Training Run */}
        <Section t={t} title="학습 실행">
          <div style={{ fontSize: 11, color: t.colors.textMuted, marginBottom: 8 }}>
            업로드된 이미지로 Gate(PatchCore) + Classifier(ResNet)를 학습합니다. 학습 전 설정을 저장하세요.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleStartTraining}
              disabled={trainState.status === 'running'}
              style={{
                ...t.btnPrimary,
                background: trainState.status === 'running' ? t.colors.textDim : t.colors.accent,
                cursor: trainState.status === 'running' ? 'not-allowed' : 'pointer',
              }}
            >
              {trainState.status === 'running'
                ? <><Loader2 size={11} className="animate-spin" /> 학습 중</>
                : <><Play size={11} /> 학습 시작</>
              }
            </button>
            {trainState.status !== 'idle' && trainState.status !== 'running' && (
              <button
                onClick={() => setTrainState({ status: 'idle', progress: 0, message: '', result: null })}
                style={t.btnSecondary}
              >
                <RotateCcw size={11} /> 결과 닫기
              </button>
            )}
            {trainState.status === 'completed' && (
              <a
                href={api.exportDataUrl()}
                download
                style={{
                  ...t.btnPrimary,
                  background: '#16a34a',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  textDecoration: 'none',
                  fontSize: 11,
                  padding: '4px 10px',
                }}
              >
                <Download size={11} /> 데이터 다운로드 (ZIP)
              </a>
            )}
            {/* 데이터 초기화 (모델 전환 등) */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                onClick={() => handleReset(true)}
                disabled={resetting || trainState.status === 'running'}
                title="학습 모델 + 파생 데이터 삭제 (원본 이미지 유지)"
                style={{
                  ...t.btnSecondary,
                  fontSize: 10,
                  opacity: (resetting || trainState.status === 'running') ? 0.5 : 1,
                  color: '#f97316',
                  border: '1px solid #f9731640',
                }}
              >
                <RotateCcw size={10} /> {resetting ? '초기화 중...' : '모델 초기화'}
              </button>
              <button
                onClick={() => handleReset(false)}
                disabled={resetting || trainState.status === 'running'}
                title="모델 + 모든 데이터 삭제 (원본 이미지 포함)"
                style={{
                  ...t.btnSecondary,
                  fontSize: 10,
                  opacity: (resetting || trainState.status === 'running') ? 0.5 : 1,
                  color: '#ef4444',
                  border: '1px solid #ef444440',
                }}
              >
                <RotateCcw size={10} /> 전체 초기화
              </button>
            </div>
          </div>

          {/* Progress */}
          {(trainState.status === 'running' || trainState.status === 'completed' || trainState.status === 'error') && (
            <div className="mt-3 space-y-2">
              {/* WS 연결 상태 — 학습 중일 때만 표시 */}
              {trainState.status === 'running' && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded" style={{
                  background: wsConnected ? t.colors.success + '12' : t.colors.warning + '12',
                  border: `1px solid ${wsConnected ? t.colors.success : t.colors.warning}25`,
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: wsConnected ? t.colors.success : t.colors.warning,
                    animation: !wsConnected ? 'pulse 1s infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 10, color: wsConnected ? t.colors.success : t.colors.warning }}>
                    {wsConnected ? '실시간 연결됨' : '연결 재시도 중… (진행률 자동 갱신 중)'}
                  </span>
                </div>
              )}
              {/* Progress bar */}
              <div className="rounded" style={{ height: 6, background: t.colors.bgInput, overflow: 'hidden' }}>
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${trainState.progress}%`,
                    background: trainState.status === 'error'
                      ? t.colors.danger
                      : trainState.status === 'completed'
                        ? t.colors.success
                        : t.colors.accent,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>

              {/* Message */}
              <div className="flex items-center gap-1.5">
                {trainState.status === 'running' && <Loader2 size={11} className="animate-spin" style={{ color: t.colors.accent }} />}
                {trainState.status === 'completed' && <CheckCircle2 size={11} style={{ color: t.colors.success }} />}
                {trainState.status === 'error' && <AlertCircle size={11} style={{ color: t.colors.danger }} />}
                <span style={{
                  fontSize: 11,
                  color: trainState.status === 'error'
                    ? t.colors.danger
                    : trainState.status === 'completed'
                      ? t.colors.success
                      : t.colors.textMuted,
                }}>
                  {trainState.message} {trainState.status === 'running' && `(${trainState.progress}%)`}
                </span>
              </div>

              {/* Result metrics */}
              {trainState.status === 'completed' && trainState.result && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {Object.entries(trainState.result).map(([k, v]) => (
                    <span key={k} style={t.badge('info')}>
                      {k}: {typeof v === 'number' ? v.toFixed(4) : v}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Next steps */}
        <div className="rounded p-3" style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            워크플로우
          </div>
          <ol style={{ fontSize: 11, color: t.colors.textMuted, listStyle: 'decimal', paddingLeft: 16 }} className="space-y-0.5">
            <li>T1~T{numTargets} 이미지 업로드</li>
            <li>설정 저장</li>
            <li><strong style={{ color: t.colors.text }}>학습 시작</strong> 클릭 → 진행률 확인</li>
            <li>학습 완료 후 모델 비교 탭에서 벤치마크 실행</li>
          </ol>
        </div>
      </div>
      </div>

      {/* ── 우측: 이미지 미리보기 패널 ── */}
      <ImagePreviewPanel
        numTargets={numTargets}
        uploadTarget={uploadTarget}
        uploadFiles={uploadFiles}
        refreshKey={uploadRefreshKey}
        onRemoveLocalFile={(i) => setUploadFiles(prev => prev.filter((_, j) => j !== i))}
        onUploadStatsChange={() => api.getUploadStats().then(r => setUploadStats(r.data)).catch(() => {})}
        t={t}
      />
    </div>
  )
}

// ── 이미지 미리보기 패널 ────────────────────────────────────────────────────

function ImagePreviewPanel({
  numTargets, uploadTarget, uploadFiles, refreshKey, onRemoveLocalFile, onUploadStatsChange, t,
}: {
  numTargets: number
  uploadTarget: number
  uploadFiles: File[]
  refreshKey: number
  onRemoveLocalFile: (i: number) => void
  onUploadStatsChange: () => void
  t: ReturnType<typeof useTheme>
}) {
  const [activeTarget, setActiveTarget] = useState(1)
  const [serverImages, setServerImages] = useState<Record<number, string[]>>({})
  const [deleting, setDeleting] = useState<string | null>(null)

  // 타겟 변경 시 서버 이미지 목록 갱신
  const fetchImages = useCallback((targetId: number) => {
    api.listTargetImages(targetId).then(r => {
      setServerImages(prev => ({ ...prev, [targetId]: r.data.images ?? [] }))
    }).catch(() => {})
  }, [])

  // numTargets 변경 또는 업로드 완료(refreshKey) 시 전체 갱신
  useEffect(() => {
    for (let i = 1; i <= numTargets; i++) fetchImages(i)
  }, [numTargets, fetchImages, refreshKey])

  // 업로드 타겟 바뀌면 해당 탭 자동 포커스
  useEffect(() => { setActiveTarget(uploadTarget) }, [uploadTarget])

  const handleDelete = async (targetId: number, filename: string) => {
    setDeleting(filename)
    try {
      await api.deleteTargetImage(targetId, filename)
      setServerImages(prev => ({
        ...prev,
        [targetId]: (prev[targetId] ?? []).filter(f => f !== filename),
      }))
      onUploadStatsChange()
    } catch { /* 무시 */ }
    finally { setDeleting(null) }
  }

  const localForThisTarget = uploadFiles  // 업로드 전 선택 파일 (현재 uploadTarget 기준)
  const serverList = serverImages[activeTarget] ?? []

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{
      borderLeft: `1px solid ${t.colors.border}`,
      background: t.colors.bgSidebar,
    }}>
      {/* 탭 헤더 */}
      <div className="flex items-center gap-0 flex-shrink-0"
           style={{ borderBottom: `1px solid ${t.colors.border}`, background: t.colors.bgPanel, minHeight: 36 }}>
        <span style={{ fontSize: 10, color: t.colors.textDim, padding: '0 12px', fontWeight: 600, flexShrink: 0 }}>
          이미지 미리보기
        </span>
        <div className="flex">
          {Array.from({ length: numTargets }, (_, i) => i + 1).map(n => {
            const count = (serverImages[n] ?? []).length + (n === uploadTarget ? uploadFiles.length : 0)
            const isActive = activeTarget === n
            return (
              <button
                key={n}
                onClick={() => { setActiveTarget(n); fetchImages(n) }}
                style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 400,
                  padding: '6px 14px',
                  color: isActive ? t.colors.accent : t.colors.textMuted,
                  background: isActive ? t.colors.bg : 'transparent',
                  borderRight: `1px solid ${t.colors.border}`,
                  borderBottom: isActive ? `2px solid ${t.colors.accent}` : '2px solid transparent',
                  position: 'relative',
                }}
              >
                T{n}
                {count > 0 && (
                  <span style={{
                    marginLeft: 4, fontSize: 9, fontWeight: 700,
                    background: isActive ? t.colors.accent : t.colors.textDim,
                    color: '#fff', borderRadius: 8, padding: '0 4px',
                  }}>{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 이미지 그리드 */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* 업로드 전 로컬 파일 (uploadTarget == activeTarget 일 때만) */}
        {activeTarget === uploadTarget && localForThisTarget.length > 0 && (
          <div className="mb-3">
            <div style={{ fontSize: 9, color: t.colors.textDim, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.06em', marginBottom: 6 }}>
              대기 중 (미업로드)
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
              {localForThisTarget.map((file, i) => (
                <LocalImageThumb key={i} file={file} onRemove={() => onRemoveLocalFile(i)} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* 서버에 올라간 이미지 */}
        {serverList.length > 0 ? (
          <div>
            <div style={{ fontSize: 9, color: t.colors.textDim, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.06em', marginBottom: 6 }}>
              업로드됨 ({serverList.length}장)
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
              {serverList.map(filename => (
                <ServerImageThumb
                  key={filename}
                  targetId={activeTarget}
                  filename={filename}
                  deleting={deleting === filename}
                  onDelete={() => handleDelete(activeTarget, filename)}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : activeTarget !== uploadTarget || localForThisTarget.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: t.colors.textDim }}>
            <span style={{ fontSize: 24, opacity: 0.2 }}>📂</span>
            <span style={{ fontSize: 11, opacity: 0.5 }}>T{activeTarget} 이미지 없음</span>
            <span style={{ fontSize: 10, opacity: 0.35, textAlign: 'center', lineHeight: 1.5 }}>
              좌측에서 T{activeTarget} 선택 후<br />이미지를 업로드하세요
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── 로컬 파일 썸네일 (업로드 전) ─────────────────────────────────────────────

function LocalImageThumb({ file, onRemove, t }: {
  file: File
  onRemove: () => void
  t: ReturnType<typeof useTheme>
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objUrl = URL.createObjectURL(file)
    setUrl(objUrl)
    return () => URL.revokeObjectURL(objUrl)
  }, [file])

  return (
    <div className="relative rounded overflow-hidden group" style={{ border: `1px solid ${t.colors.border}`, background: t.colors.bgInput }}>
      {url && (
        <img src={url} alt={file.name}
             style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
      )}
      <div className="absolute inset-0 flex flex-col justify-between p-1 opacity-0 group-hover:opacity-100 transition-opacity"
           style={{ background: 'rgba(0,0,0,0.55)' }}>
        <button
          onClick={onRemove}
          className="self-end rounded-full flex items-center justify-center"
          style={{ width: 18, height: 18, background: t.colors.danger, color: '#fff' }}>
          <X size={10} />
        </button>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.8)', wordBreak: 'break-all', lineHeight: 1.3 }}>
          {file.name.length > 14 ? file.name.slice(0, 12) + '…' : file.name}
        </span>
      </div>
      {/* 미업로드 배지 */}
      <div className="absolute top-1 left-1 rounded px-1"
           style={{ background: '#f59e0b', fontSize: 8, color: '#fff', fontWeight: 700 }}>
        대기
      </div>
    </div>
  )
}

// ── 서버 이미지 썸네일 (업로드 완료) ─────────────────────────────────────────

function ServerImageThumb({ targetId, filename, deleting, onDelete, t }: {
  targetId: number
  filename: string
  deleting: boolean
  onDelete: () => void
  t: ReturnType<typeof useTheme>
}) {
  const imgUrl = api.getTargetImageUrl(targetId, filename)

  return (
    <div className="relative rounded overflow-hidden group"
         style={{ border: `1px solid ${t.colors.border}`, background: t.colors.bgInput, opacity: deleting ? 0.5 : 1 }}>
      <img src={imgUrl} alt={filename}
           style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
      <div className="absolute inset-0 flex flex-col justify-between p-1 opacity-0 group-hover:opacity-100 transition-opacity"
           style={{ background: 'rgba(0,0,0,0.55)' }}>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="self-end rounded-full flex items-center justify-center"
          style={{ width: 18, height: 18, background: t.colors.danger, color: '#fff' }}>
          {deleting ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
        </button>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.8)', wordBreak: 'break-all', lineHeight: 1.3 }}>
          {filename.length > 14 ? filename.slice(0, 12) + '…' : filename}
        </span>
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
