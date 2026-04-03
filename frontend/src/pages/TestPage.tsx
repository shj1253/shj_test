import { useState, useCallback } from 'react'
import { Upload, Play, FileImage } from 'lucide-react'
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
    <div className="p-6 grid grid-cols-2 gap-6">
      {/* 왼쪽: 입력 */}
      <div className="flex flex-col gap-4">
        {/* 모드 선택 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">테스트 모드</h2>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setFileMode('upload')}
              className={`px-3 py-1.5 rounded text-sm ${fileMode === 'upload' ? 'bg-blue-600' : 'bg-gray-800 text-gray-400'}`}
            >
              파일 업로드
            </button>
            <button
              onClick={() => setFileMode('path')}
              className={`px-3 py-1.5 rounded text-sm ${fileMode === 'path' ? 'bg-blue-600' : 'bg-gray-800 text-gray-400'}`}
            >
              경로 지정
            </button>
          </div>

          {fileMode === 'upload' ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <FileImage className="mx-auto mb-2 text-gray-500" size={32} />
              <p className="text-sm text-gray-400">이미지를 드래그하거나 클릭해서 선택</p>
              <p className="text-xs text-gray-600 mt-1">JPG, PNG 지원 | 복수 선택 가능</p>
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
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
              />
              <button
                onClick={handlePathStart}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
              >
                <Play size={14} /> 시작
              </button>
            </div>
          )}

          {loading && <p className="mt-2 text-xs text-blue-400 animate-pulse">추론 중...</p>}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* 시퀀스 */}
        <SequenceIndicator currentState={sequenceState} lastResult={null} />
      </div>

      {/* 오른쪽: 결과 목록 */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">추론 결과</h2>
          <span className="text-xs text-gray-500">{results.length}개</span>
        </div>
        <div className="overflow-y-auto max-h-[600px]">
          {results.length === 0 ? (
            <div className="p-8 text-center text-gray-600 text-sm">
              이미지를 업로드하면 결과가 표시됩니다
            </div>
          ) : (
            results.map((r, i) => (
              <div key={r.frame_id} className="p-4 border-b border-gray-800 hover:bg-gray-800/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-gray-500">#{results.length - i}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.is_confirmed
                      ? 'bg-green-900 text-green-300'
                      : r.gate?.is_target
                      ? 'bg-blue-900 text-blue-300'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {r.is_confirmed ? '✓ 확정' : r.gate?.is_target ? 'Gate통과' : 'OOD'}
                  </span>
                </div>
                {r.classify && (
                  <div className="text-sm">
                    <span className="text-blue-400 font-medium">T{r.classify.target_id}</span>
                    <span className="text-gray-400 ml-2">
                      ({(r.classify.confidence * 100).toFixed(1)}%)
                    </span>
                    {r.classify.is_uncertain && (
                      <span className="ml-2 text-yellow-400 text-xs">⚠ AL큐</span>
                    )}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">
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
