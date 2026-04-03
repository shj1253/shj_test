import type { MetricsSnapshot } from '../../types'

interface Props {
  metrics: MetricsSnapshot | null
}

function MetricRow({ label, value, color = 'text-gray-200' }: {
  label: string; value: string; color?: string
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-sm font-mono font-medium ${color}`}>{value}</span>
    </div>
  )
}

export default function MetricsPanel({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">실시간 지표</h2>
        <p className="text-gray-600 text-sm text-center py-4">수집 중...</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">실시간 지표</h2>
        <span className="text-xs text-gray-600">윈도우 {metrics.window_size}프레임</span>
      </div>

      <div className="space-y-0">
        <MetricRow
          label="Accuracy"
          value={`${(metrics.accuracy * 100).toFixed(1)}%`}
          color="text-green-400"
        />
        <MetricRow
          label="F1 (macro)"
          value={`${(metrics.f1 * 100).toFixed(1)}%`}
          color="text-blue-400"
        />
        <MetricRow
          label="Precision"
          value={`${(metrics.precision * 100).toFixed(1)}%`}
          color="text-purple-400"
        />
        <MetricRow
          label="Recall"
          value={`${(metrics.recall * 100).toFixed(1)}%`}
          color="text-yellow-400"
        />
        <div className="my-2 border-t border-gray-700" />
        <MetricRow
          label="Avg Latency"
          value={`${metrics.avg_latency_ms.toFixed(1)}ms`}
          color="text-orange-400"
        />
        <MetricRow
          label="P95 Latency"
          value={`${metrics.p95_latency_ms.toFixed(1)}ms`}
          color="text-red-400"
        />
        <div className="my-2 border-t border-gray-700" />
        <MetricRow
          label="Gate 통과율"
          value={`${(metrics.gate_pass_rate * 100).toFixed(1)}%`}
          color="text-cyan-400"
        />
        <MetricRow
          label="AL 큐"
          value={`${metrics.al_queue_size}건`}
          color="text-pink-400"
        />
        <MetricRow
          label="확정 건수"
          value={`${metrics.confirmed_count}건`}
          color="text-emerald-400"
        />
      </div>
    </div>
  )
}
