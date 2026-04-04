import { useState, useCallback } from 'react'
import { Upload, Play, Image } from 'lucide-react'
import { api } from '../api/httpClient'
import type { InferenceResult } from '../types'
import SequenceIndicator from '../components/SequenceIndicator/SequenceIndicator'
import { useInferenceStore } from '../store'

export default function TestPage() {
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
    try {
      setError(null)
      await api.startFile(filePath, false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '파일 소스 시작 실패')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFileUpload(e.dataTransfer.files)
  }, [])

  return (
    <div className="p-5 grid grid-cols-2 gap-4 h-[calc(100vh-44px)]">
      {/* 입력 */}
      <div className="flex flex-col gap-3 overflow-y-auto">
        <div className="panel p-4">
          <h2 className="panel-header mb-3">테스트 입력</h2>
          <div className="flex gap-1.5 mb-3">
            <button
              onClick={() => setFileMode('upload')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                fileMode === 'upload'
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                  : 'bg-[#1e293b] text-slate-500 border border-transparent'
              }`}
            >
              파일 업로드
            </button>
            <button
              onClick={() => setFileMode('path')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                fileMode === 'path'
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                  : 'bg-[#1e293b] text-slate-500 border border-transparent'
              }`}
            >
              경로 지정
            </button>
          </div>

          {fileMode === 'upload' ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border border-dashed border-[#1e293b] rounded-lg p-8 text-center
                         cursor-pointer hover:border-blue-500/40 transition-colors"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Image className="mx-auto mb-2 text-slate-600" size={28} strokeWidth={1.5} />
              <p className="text-xs text-slate-500">이미지를 드래그하거나 클릭하여 선택</p>
              <p className="text-[10px] text-slate-600 mt-1">JPG, PNG | 복수 선택 가능</p>
              <input
                id="file-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="이미지/영상 파일 경로 또는 디렉터리"
                className="input text-xs"
              />
              <button onClick={handlePathStart} className="btn-primary">
                <Play size={12} /> 시작
              </button>
            </div>
          )}

          {loading && <p className="mt-2 text-[11px] text-blue-400 animate-pulse">추론 중...</p>}
          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        </div>

        <SequenceIndicator currentState={sequenceState} lastResult={null} />
      </div>

      {/* 결과 목록 */}
      <div className="panel overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-[#1e293b] flex items-center justify-between shrink-0">
          <h2 className="panel-header">추론 결과</h2>
          <span className="text-[10px] text-slate-600 font-mono">{results.length}건</span>
        </div>
        <div className="overflow-y-auto flex-1">
          {results.length === 0 ? (
            <div className="p-8 text-center text-slate-600 text-xs">
              이미지를 업로드하면 결과가 표시됩니다
            </div>
          ) : (
            results.map((r, i) => (
              <div key={r.frame_id} className="px-4 py-3 border-b border-[#1e293b] hover:bg-[#0f172a] transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-slate-600">#{results.length - i}</span>
                  <span className={`badge ${
                    r.is_confirmed
                      ? 'badge-success'
                      : r.gate?.is_target
                      ? 'badge-info'
                      : 'badge-neutral'
                  }`}>
                    {r.is_confirmed ? 'CONFIRMED' : r.gate?.is_target ? 'GATE PASS' : 'OOD'}
                  </span>
                </div>
                {r.classify && (
                  <div className="text-xs">
                    <span className="text-blue-400 font-medium font-mono">T{r.classify.target_id}</span>
                    <span className="text-slate-500 ml-2">
                      {(r.classify.confidence * 100).toFixed(1)}%
                    </span>
                    {r.classify.is_uncertain && (
                      <span className="ml-2 badge badge-warning">AL</span>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-slate-600 mt-1 font-mono">
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
