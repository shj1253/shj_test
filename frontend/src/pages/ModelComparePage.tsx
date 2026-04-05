import { useState, useEffect } from 'react'
import { Play, Trophy, ArrowUp, Upload, Image, AlertCircle, Info } from 'lucide-react'
import { api } from '../api/httpClient'
import { useTheme } from '../hooks/useTheme'

interface BenchmarkResult {
  winner: string
  winner_reason: string
  pipeline_a: Record<string, number | string>
  pipeline_b: Record<string, number | string>
  comparison: Record<string, number>
  label_info?: { labeled: number; unlabeled: number; tip: string }
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  f1_macro: 'F1 (macro)',
  precision_macro: 'Precision',
  recall_macro: 'Recall',
  gate_tpr: 'Gate TPR',
  gate_tnr: 'Gate TNR',
  gate_fpr: 'Gate FPR',
  avg_total_ms: 'Avg Latency',
  p95_total_ms: 'P95 Latency',
  gate_pass_rate: 'Gate Pass Rate',
}

export default function ModelComparePage() {
  const t = useTheme()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [modelStatus, setModelStatus] = useState<{ gate_a: boolean; gate_b: boolean } | null>(null)

  useEffect(() => {
    api.listModels().then(res => {
      const gates: { key: string; is_loaded: boolean }[] = res.data.gates ?? []
      setModelStatus({
        gate_a: gates.some(g => g.key === 'gate_a' && g.is_loaded),
        gate_b: gates.some(g => g.key === 'gate_b' && g.is_loaded),
      })
    }).catch(() => {})
  }, [result])

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return
    setFiles(prev => [...prev, ...Array.from(fileList)])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleRun = async () => {
    if (files.length === 0) {
      setError('테스트 이미지를 업로드하세요')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      fd.append('gate_a_key', 'gate_a')
      fd.append('gate_b_key', 'gate_b')
      fd.append('classifier_key', 'classifier')
      const res = await api.compareModelsUpload(fd)
      setResult(res.data as BenchmarkResult)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '벤치마크 실패')
    } finally {
      setLoading(false)
    }
  }

  const renderMetricValue = (key: string, value: unknown) => {
    if (typeof value !== 'number') return String(value)
    if (key.endsWith('_ms')) return `${value.toFixed(1)}ms`
    if (key.endsWith('_rate') || ['accuracy','f1_macro','precision_macro','recall_macro','gate_tpr','gate_tnr','gate_fpr'].includes(key)) {
      return `${(value * 100).toFixed(1)}%`
    }
    return value.toFixed(4)
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3 max-w-4xl">
      {/* Upload area */}
      <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
        <div style={t.sectionHeader} className="mb-2">테스트 이미지 업로드</div>

        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => document.getElementById('compare-file-input')?.click()}
          className="rounded p-4 text-center cursor-pointer transition-colors mb-2"
          style={{ border: `1px dashed ${t.colors.border}`, background: t.colors.bgDropzone }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.colors.accent + '60' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.colors.border }}
        >
          <Upload size={20} className="mx-auto mb-1" style={{ color: t.colors.textDim }} />
          <p style={{ fontSize: 11, color: t.colors.textMuted }}>테스트할 이미지를 드래그하거나 클릭하여 업로드</p>
          <p style={{ fontSize: 10, color: t.colors.textDim, marginTop: 2 }}>JPG, PNG | 복수 선택 가능</p>
          <input id="compare-file-input" type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {files.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded px-2 py-0.5 cursor-pointer"
                style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}`, fontSize: 10, color: t.colors.textMuted }}
                onClick={() => removeFile(i)}
                title="클릭하여 제거"
              >
                <Image size={10} />
                {f.name.length > 15 ? f.name.slice(0, 12) + '...' : f.name}
                <span style={{ color: t.colors.textDim }}>x</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={handleRun} disabled={loading} style={t.btnPrimary}>
            <Play size={11} />{loading ? '실행 중...' : '비교 실행'}
          </button>
          <span style={{ fontSize: 10, color: t.colors.textDim }}>
            {files.length}개 이미지 선택됨
          </span>
        </div>
        {error && <p style={{ fontSize: 11, color: t.colors.danger, marginTop: 4 }}>{error}</p>}
      </div>

      {/* Model readiness */}
      {modelStatus && (
        <div className="rounded p-3 space-y-1.5" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
          <div style={{ fontSize: 11, color: t.colors.textMuted, fontWeight: 500, marginBottom: 4 }}>모델 준비 상태</div>
          {[
            { key: 'gate_a', label: 'Pipeline A', desc: 'PatchCore Gate + ResNet' },
            { key: 'gate_b', label: 'Pipeline B', desc: 'EfficientNet Gate + ResNet' },
          ].map(({ key, label, desc }) => {
            const loaded = modelStatus[key as 'gate_a' | 'gate_b']
            return (
              <div key={key} className="flex items-center gap-2">
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: loaded ? t.colors.success : t.colors.warning,
                  flexShrink: 0, display: 'inline-block',
                }} />
                <span style={{ fontSize: 11, color: t.colors.textHeading, fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 10, color: t.colors.textDim }}>{desc}</span>
                {!loaded && (
                  <span style={{ fontSize: 10, color: t.colors.warning }}>미학습</span>
                )}
              </div>
            )
          })}
          {!modelStatus.gate_b && (
            <div className="flex items-start gap-1.5 mt-2 rounded px-2 py-1.5" style={{
              background: t.colors.warning + '12', border: `1px solid ${t.colors.warning}25`,
            }}>
              <Info size={11} style={{ color: t.colors.warning, marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: t.colors.warning }}>
                Pipeline B(EfficientNet)가 미학습 상태입니다. <code style={{ background: t.colors.bgInput, padding: '0 2px' }}>POST /models/load</code>로 gate_b를 등록하거나, 사전학습 탭에서 학습 후 <code style={{ background: t.colors.bgInput, padding: '0 2px' }}>POST /models/swap-gate</code>로 교체하세요.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <>
          {result.label_info && result.label_info.unlabeled > 0 && (
            <div className="flex items-start gap-1.5 rounded px-3 py-2" style={{
              background: t.colors.warning + '12',
              border: `1px solid ${t.colors.warning}25`,
            }}>
              <AlertCircle size={11} style={{ color: t.colors.warning, marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: t.colors.warning }}>
                {result.label_info.unlabeled}개 이미지 레이블 미인식 — 분류 정확도 측정 불가. {result.label_info.tip}
              </span>
            </div>
          )}
          <div className="rounded p-3" style={{
            background: t.colors.bgPanel,
            border: `1px solid ${result.winner === 'TIE' ? t.colors.border : t.colors.warning + '40'}`,
          }}>
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={14} style={{ color: t.colors.warning }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: t.colors.textHeading }}>
                {result.winner === 'TIE' ? '무승부' : `Pipeline ${result.winner} 우위`}
              </span>
            </div>
            <p style={{ fontSize: 11, color: t.colors.textMuted }}>{result.winner_reason}</p>
          </div>

          {/* ── 핵심 지표 막대 차트 ── */}
          <div className="rounded p-3 space-y-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
            <div style={t.sectionHeader}>핵심 지표 비교</div>
            {(['f1_macro', 'accuracy', 'gate_tpr', 'avg_total_ms'] as const).map(key => {
              const label = METRIC_LABELS[key] ?? key
              const rawA = result.pipeline_a[key] as number
              const rawB = result.pipeline_b[key] as number
              if (rawA == null || rawB == null) return null
              const lowerIsBetter = key.endsWith('_ms')
              const max = Math.max(rawA, rawB) * (lowerIsBetter ? 1 : 1)
              const pctA = max === 0 ? 0 : Math.min(100, (rawA / max) * 100)
              const pctB = max === 0 ? 0 : Math.min(100, (rawB / max) * 100)
              const aWins = lowerIsBetter ? rawA < rawB : rawA > rawB
              const bWins = lowerIsBetter ? rawB < rawA : rawB > rawA
              const colorA = aWins ? t.colors.success : bWins ? t.colors.textDim : t.colors.accent
              const colorB = bWins ? t.colors.success : aWins ? t.colors.textDim : t.colors.accent

              return (
                <div key={key}>
                  <div className="flex justify-between mb-1">
                    <span style={{ fontSize: 10, color: t.colors.textMuted, fontWeight: 600 }}>{label}</span>
                    <span style={{ fontSize: 9, color: t.colors.textDim }}>{lowerIsBetter ? '낮을수록 좋음' : '높을수록 좋음'}</span>
                  </div>
                  <div className="space-y-1">
                    {[{ label: 'A', pct: pctA, val: rawA, color: colorA, wins: aWins },
                      { label: 'B', pct: pctB, val: rawB, color: colorB, wins: bWins }].map(({ label: pl, pct, val, color, wins }) => (
                      <div key={pl} className="flex items-center gap-2">
                        <span style={{ fontSize: 10, fontWeight: 700, color, width: 18, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>{pl}</span>
                        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 10, background: t.colors.bgInput }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            background: color,
                            borderRadius: 999,
                            transition: 'width 0.6s ease',
                            boxShadow: wins ? `0 0 6px ${color}60` : 'none',
                          }} />
                        </div>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color, fontWeight: wins ? 700 : 400, width: 52, textAlign: 'left', flexShrink: 0 }}>
                          {renderMetricValue(key, val)}{wins && ' ▲'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── 상세 수치 테이블 ── */}
          <div className="rounded overflow-hidden" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
            <div className="grid grid-cols-3" style={{ background: t.colors.bgInput }}>
              <div className="p-2" style={t.sectionHeader}>Metric</div>
              <div className="p-2 text-center" style={{ ...t.sectionHeader, borderLeft: `1px solid ${t.colors.border}` }}>Pipeline A</div>
              <div className="p-2 text-center" style={{ ...t.sectionHeader, borderLeft: `1px solid ${t.colors.border}` }}>Pipeline B</div>
            </div>
            {Object.entries(METRIC_LABELS).map(([key, label]) => {
              const valA = result.pipeline_a[key] as number
              const valB = result.pipeline_b[key] as number
              const lowerIsBetter = key.endsWith('_ms') || key === 'gate_fpr'
              const aWins = lowerIsBetter ? valA < valB : valA > valB
              const bWins = lowerIsBetter ? valB < valA : valB > valA

              return (
                <div key={key} className="grid grid-cols-3" style={{ borderTop: `1px solid ${t.colors.border}` }}
                     onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bgHover }}
                     onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                  <div className="p-2" style={{ fontSize: 11, color: t.colors.textMuted }}>{label}</div>
                  <div className="p-2 text-center" style={{ fontSize: 11, fontFamily: 'monospace', borderLeft: `1px solid ${t.colors.border}`, color: aWins ? t.colors.success : t.colors.text, fontWeight: aWins ? 500 : 400 }}>
                    {renderMetricValue(key, valA)}
                    {aWins && <ArrowUp size={9} className="inline ml-0.5" />}
                  </div>
                  <div className="p-2 text-center" style={{ fontSize: 11, fontFamily: 'monospace', borderLeft: `1px solid ${t.colors.border}`, color: bWins ? t.colors.success : t.colors.text, fontWeight: bWins ? 500 : 400 }}>
                    {renderMetricValue(key, valB)}
                    {bWins && <ArrowUp size={9} className="inline ml-0.5" />}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
