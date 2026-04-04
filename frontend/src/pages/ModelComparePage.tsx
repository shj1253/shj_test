import { useState } from 'react'
import { Play, Trophy, ArrowUp } from 'lucide-react'
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
  avg_total_ms: 'Avg Latency',
  p95_total_ms: 'P95 Latency',
  gate_pass_rate: 'Gate Pass Rate',
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
    <div className="p-5 space-y-4 max-w-4xl mx-auto">
      {/* 설정 */}
      <div className="panel p-4">
        <h2 className="panel-header mb-3">벤치마크 설정</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[11px] text-slate-500 block mb-1">테스트 이미지 경로</label>
            <input
              type="text"
              value={testDir}
              onChange={(e) => setTestDir(e.target.value)}
              className="input text-xs"
            />
          </div>
          <button
            onClick={handleRun}
            disabled={loading}
            className="btn-primary"
          >
            <Play size={12} />
            {loading ? '실행 중...' : '비교 실행'}
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      </div>

      {/* 안내 */}
      {!result && !loading && (
        <div className="panel p-4 text-xs text-slate-500">
          <p className="font-medium text-slate-400 mb-2">비교 대상</p>
          <ul className="space-y-1 text-[11px]">
            <li><span className="text-slate-300 font-medium">Pipeline A</span> -- PatchCore Gate + ResNet Classifier</li>
            <li><span className="text-slate-300 font-medium">Pipeline B</span> -- EfficientNet Gate + ResNet Classifier</li>
          </ul>
          <p className="mt-2 text-[10px] text-slate-600">
            두 모델을 모두 학습한 후에 비교를 실행하세요.
          </p>
        </div>
      )}

      {/* 결과 */}
      {result && (
        <>
          {/* 승자 */}
          <div className={`panel p-4 ${
            result.winner === 'TIE'
              ? 'border-slate-600'
              : 'border-amber-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={14} className="text-amber-400" />
              <span className="text-sm font-semibold text-slate-200">
                {result.winner === 'TIE' ? '무승부' : `Pipeline ${result.winner} 우위`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">{result.winner_reason}</p>
          </div>

          {/* 비교 표 */}
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-3 bg-[#0f172a] text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              <div className="p-3">Metric</div>
              <div className="p-3 text-center border-l border-[#1e293b]">Pipeline A</div>
              <div className="p-3 text-center border-l border-[#1e293b]">Pipeline B</div>
            </div>
            {Object.entries(METRIC_LABELS).map(([key, label]) => {
              const valA = result.pipeline_a[key] as number
              const valB = result.pipeline_b[key] as number
              const isLatency = key.endsWith('_ms')
              const isFpr = key === 'gate_fpr'
              const lowerIsBetter = isLatency || isFpr
              const aWins = lowerIsBetter ? valA < valB : valA > valB
              const bWins = lowerIsBetter ? valB < valA : valB > valA

              return (
                <div key={key} className="grid grid-cols-3 border-t border-[#1e293b] hover:bg-[#0f172a]/50">
                  <div className="p-3 text-xs text-slate-400">{label}</div>
                  <div className={`p-3 text-center font-mono text-xs border-l border-[#1e293b] ${
                    aWins ? 'text-emerald-400 font-medium' : 'text-slate-400'
                  }`}>
                    {renderMetricValue(key, valA)}
                    {aWins && <ArrowUp size={10} className="inline ml-1" />}
                  </div>
                  <div className={`p-3 text-center font-mono text-xs border-l border-[#1e293b] ${
                    bWins ? 'text-emerald-400 font-medium' : 'text-slate-400'
                  }`}>
                    {renderMetricValue(key, valB)}
                    {bWins && <ArrowUp size={10} className="inline ml-1" />}
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
