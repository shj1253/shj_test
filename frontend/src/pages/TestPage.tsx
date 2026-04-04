import { useState, useCallback } from 'react'
import { Play, Image } from 'lucide-react'
import { api } from '../api/httpClient'
import type { InferenceResult } from '../types'
import SequenceIndicator from '../components/SequenceIndicator/SequenceIndicator'
import { useInferenceStore } from '../store'
import { useTheme } from '../hooks/useTheme'

export default function TestPage() {
  const t = useTheme()
  const [results, setResults] = useState<InferenceResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')
  const [fileMode, setFileMode] = useState<'upload' | 'path'>('upload')
  const { sequenceState, setResult } = useInferenceStore()

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setLoading(true)
    setError(null)
    const newResults: InferenceResult[] = []
    for (const file of Array.from(files)) {
      try {
        const res = await api.inferImage(file)
        newResults.push(res.data)
        setResult(res.data)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '추론 실패')
      }
    }
    setResults((prev) => [...newResults, ...prev])
    setLoading(false)
  }

  const handlePathStart = async () => {
    if (!filePath) return
    try { setError(null); await api.startFile(filePath, false) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : '파일 소스 시작 실패') }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileUpload(e.dataTransfer.files)
  }, [])

  return (
    <div className="h-full flex gap-px" style={{ background: t.colors.border }}>
      {/* Left: Input */}
      <div className="flex flex-col gap-px" style={{ width: 360, background: t.colors.border }}>
        <div className="p-3" style={{ background: t.colors.bgPanel }}>
          <div style={t.sectionHeader} className="mb-2">테스트 입력</div>
          <div className="flex gap-1 mb-2">
            {(['upload', 'path'] as const).map(m => (
              <button key={m} onClick={() => setFileMode(m)}
                style={{
                  padding: '3px 10px', borderRadius: 3, fontSize: 11, fontWeight: 500,
                  color: fileMode === m ? t.colors.accent : t.colors.textMuted,
                  background: fileMode === m ? t.colors.accentMuted : t.colors.bgInput,
                  border: `1px solid ${fileMode === m ? t.colors.accent + '40' : 'transparent'}`,
                }}
              >
                {m === 'upload' ? '파일 업로드' : '경로 지정'}
              </button>
            ))}
          </div>

          {fileMode === 'upload' ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('file-input')?.click()}
              className="rounded p-6 text-center cursor-pointer transition-colors"
              style={{ border: `1px dashed ${t.colors.border}`, background: t.colors.bgDropzone }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.colors.accent + '60' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.colors.border }}
            >
              <Image className="mx-auto mb-1" size={24} style={{ color: t.colors.textDim }} strokeWidth={1.5} />
              <p style={{ fontSize: 11, color: t.colors.textMuted }}>이미지 드래그 또는 클릭</p>
              <p style={{ fontSize: 10, color: t.colors.textDim, marginTop: 2 }}>JPG, PNG | 복수 선택 가능</p>
              <input id="file-input" type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)} />
            </div>
          ) : (
            <div className="space-y-2">
              <input type="text" value={filePath} onChange={(e) => setFilePath(e.target.value)}
                placeholder="이미지/영상 파일 경로" style={t.input} />
              <button onClick={handlePathStart} style={t.btnPrimary}>
                <Play size={11} /> 시작
              </button>
            </div>
          )}

          {loading && <p style={{ fontSize: 11, color: t.colors.accent, marginTop: 4 }} className="animate-pulse">추론 중...</p>}
          {error && <p style={{ fontSize: 11, color: t.colors.danger, marginTop: 4 }}>{error}</p>}
        </div>

        <div className="p-3" style={{ background: t.colors.bgPanel }}>
          <SequenceIndicator currentState={sequenceState} lastResult={null} />
        </div>

        <div className="flex-1" style={{ background: t.colors.bgPanel }} />
      </div>

      {/* Right: Results */}
      <div className="flex-1 flex flex-col" style={{ background: t.colors.bgPanel }}>
        <div className="px-3 py-2 flex items-center justify-between shrink-0" style={{ borderBottom: `1px solid ${t.colors.border}` }}>
          <div style={t.sectionHeader}>추론 결과</div>
          <span style={{ fontSize: 10, color: t.colors.textDim, fontFamily: 'monospace' }}>{results.length}건</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="p-6 text-center" style={{ fontSize: 11, color: t.colors.textDim }}>
              이미지를 업로드하면 결과가 표시됩니다
            </div>
          ) : (
            results.map((r, i) => (
              <div key={r.frame_id} className="px-3 py-2 transition-colors"
                   style={{ borderBottom: `1px solid ${t.colors.border}` }}
                   onMouseEnter={(e) => { e.currentTarget.style.background = t.colors.bgHover }}
                   onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textDim }}>#{results.length - i}</span>
                  <span style={t.badge(r.is_confirmed ? 'success' : r.gate?.is_target ? 'info' : 'neutral')}>
                    {r.is_confirmed ? 'CONFIRMED' : r.gate?.is_target ? 'GATE PASS' : 'OOD'}
                  </span>
                </div>
                {r.classify && (
                  <div style={{ fontSize: 11 }}>
                    <span style={{ color: t.colors.info, fontWeight: 500, fontFamily: 'monospace' }}>T{r.classify.target_id}</span>
                    <span style={{ color: t.colors.textMuted, marginLeft: 6 }}>
                      {(r.classify.confidence * 100).toFixed(1)}%
                    </span>
                    {r.classify.is_uncertain && (
                      <span style={{ ...t.badge('warning'), marginLeft: 6 }}>AL</span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 10, color: t.colors.textDim, fontFamily: 'monospace', marginTop: 2 }}>
                  {r.total_latency_ms.toFixed(1)}ms
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
