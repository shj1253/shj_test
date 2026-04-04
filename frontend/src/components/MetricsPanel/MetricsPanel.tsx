import type { MetricsSnapshot } from '../../types'

interface Props {
  metrics: MetricsSnapshot | null
}

interface MetricDef {
  label: string
  key: keyof MetricsSnapshot
  format: (v: number) => string
  color: string
  group: 'accuracy' | 'latency' | 'pipeline'
}

const METRIC_DEFS: MetricDef[] = [
  { label: 'Accuracy', key: 'accuracy', format: v => `${(v * 100).toFixed(1)}%`, color: 'text-emerald-400', group: 'accuracy' },
  { label: 'F1 (macro)', key: 'f1', format: v => `${(v * 100).toFixed(1)}%`, color: 'text-blue-400', group: 'accuracy' },
  { label: 'Precision', key: 'precision', format: v => `${(v * 100).toFixed(1)}%`, color: 'text-violet-400', group: 'accuracy' },
  { label: 'Recall', key: 'recall', format: v => `${(v * 100).toFixed(1)}%`, color: 'text-amber-400', group: 'accuracy' },
  { label: 'Avg Latency', key: 'avg_latency_ms', format: v => `${v.toFixed(1)}ms`, color: 'text-orange-400', group: 'latency' },
  { label: 'P95 Latency', key: 'p95_latency_ms', format: v => `${v.toFixed(1)}ms`, color: 'text-red-400', group: 'latency' },
  { label: 'Gate 통과율', key: 'gate_pass_rate', format: v => `${(v * 100).toFixed(1)}%`, color: 'text-cyan-400', group: 'pipeline' },
  { label: 'AL Queue', key: 'al_queue_size', format: v => `${v}`, color: 'text-pink-400', group: 'pipeline' },
  { label: '확정 건수', key: 'confirmed_count', format: v => `${v}`, color: 'text-emerald-400', group: 'pipeline' },
]

export default function MetricsPanel({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="panel p-4">
        <h2 className="panel-header mb-3">실시간 지표</h2>
        <p className="text-slate-600 text-xs text-center py-6">데이터 수집 대기 중</p>
      </div>
    )
  }

  const groups = [
    { id: 'accuracy' as const, label: '정확도' },
    { id: 'latency' as const, label: '레이턴시' },
    { id: 'pipeline' as const, label: '파이프라인' },
  ]

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-header">실시간 지표</h2>
        <span className="text-[10px] text-slate-600 font-mono">{metrics.window_size}f</span>
      </div>

      {groups.map((group, gi) => (
        <div key={group.id}>
          {gi > 0 && <div className="divider my-2" />}
          <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5 mt-1">{group.label}</div>
          {METRIC_DEFS.filter(m => m.group === group.id).map(({ label, key, format, color }) => (
            <div key={key} className="flex justify-between items-center py-1">
              <span className="text-[11px] text-slate-500">{label}</span>
              <span className={`text-xs font-mono font-medium ${color}`}>
                {format(metrics[key] as number)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
