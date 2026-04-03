import { useState } from 'react'
import { Play, Trophy, Clock, Target } from 'lucide-react'
import { api } from '../api/httpClient'

interface BenchmarkResult {
  winner: string
  winner_reason: string
  pipeline_a: Record<string, number | string>
  pipeline_b: Record<string, number | string>
  comparison: Record<string, number>
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  f1_macro: 'F1 (macro)',
  precision_macro: 'Precision',
  recall_macro: 'Recall',
  gate_tpr: 'Gate TPR',
  gate_tnr: 'Gate TNR',
  gate_fpr: 'Gate FPR',
  avg_total_ms: 'Avg Latency (ms)',
  p95_total_ms: 'P95 Latency (ms)',
  gate_pass_rate: 'Gate 통과율',
}

export default function ModelComparePage() {
  const [testDir, setTestDir] = useState('artifacts/data/raw')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.compareModels({
        gate_a_key: 'gate_a',
        gate_b_key: 'gate_b',
        classifier_key: 'classifier',
        test_images_dir: testDir,
      })
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
    <div className="p-6 space-y-6">
      {/* 설정 */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">벤치마크 설정</h2>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">테스트 이미지 디렉터리</label>
            <input
              type="text"
              value={testDir}
              onChange={(e) => setTestDir(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleRun}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            <Play size={14} />
            {loading ? '실행 중...' : '비교 실행'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {/* 안내 */}
      {!result && !loading && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-sm text-gray-400">
          <p className="font-medium mb-2">비교 대상:</p>
          <ul className="space-y-1 text-gray-500">
            <li>• <strong className="text-gray-300">Pipeline A</strong>: PatchCore Gate + ResNet Classifier</li>
            <li>• <strong className="text-gray-300">Pipeline B</strong>: EfficientNet Gate + ResNet Classifier</li>
          </ul>
          <p className="mt-2 text-xs text-gray-600">
            두 모델을 모두 학습한 후에 비교를 실행하세요.
          </p>
        </div>
      )}

      {/* 결과 */}
      {result && (
        <>
          {/* 승자 */}
          <div className={`rounded-xl p-4 border ${
            result.winner === 'TIE'
              ? 'bg-gray-900 border-gray-600'
              : 'bg-yellow-900/30 border-yellow-600/50'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={16} className="text-yellow-400" />
              <span className="font-semibold">
                {result.winner === 'TIE' ? '무승부' : `Pipeline ${result.winner} 승리`}
              </span>
            </div>
            <p className="text-sm text-gray-400">{result.winner_reason}</p>
          </div>

          {/* 비교 표 */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-3 bg-gray-800 text-xs font-medium text-gray-400 uppercase tracking-wide">
              <div className="p-3">지표</div>
              <div className="p-3 text-center border-l border-gray-700">
                Pipeline A (PatchCore)
              </div>
              <div className="p-3 text-center border-l border-gray-700">
                Pipeline B (EfficientNet)
              </div>
            </div>
            {Object.entries(METRIC_LABELS).map(([key, label]) => {
              const valA = result.pipeline_a[key] as number
              const valB = result.pipeline_b[key] as number
              const isLatency = key.endsWith('_ms')
              const isFpr = key === 'gate_fpr'
              // 낮을수록 좋은 지표
              const lowerIsBetter = isLatency || isFpr
              const aWins = lowerIsBetter ? valA < valB : valA > valB
              const bWins = lowerIsBetter ? valB < valA : valB > valA

              return (
                <div key={key} className="grid grid-cols-3 border-t border-gray-800 hover:bg-gray-800/50">
                  <div className="p-3 text-sm text-gray-400">{label}</div>
                  <div className={`p-3 text-center font-mono text-sm border-l border-gray-800 ${
                    aWins ? 'text-green-400 font-medium' : 'text-gray-300'
                  }`}>
                    {renderMetricValue(key, valA)}
                    {aWins && ' ▲'}
                  </div>
                  <div className={`p-3 text-center font-mono text-sm border-l border-gray-800 ${
                    bWins ? 'text-green-400 font-medium' : 'text-gray-300'
                  }`}>
                    {renderMetricValue(key, valB)}
                    {bWins && ' ▲'}
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
