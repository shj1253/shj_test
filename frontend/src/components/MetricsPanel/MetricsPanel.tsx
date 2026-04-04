import type { MetricsSnapshot } from '../../types'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  metrics: MetricsSnapshot | null
}

export default function MetricsPanel({ metrics }: Props) {
  const t = useTheme()

  if (!metrics) {
    return (
      <div className="p-3">
        <div style={t.sectionHeader} className="mb-2">실시간 지표</div>
        <p style={{ fontSize: 11, color: t.colors.textDim, textAlign: 'center', padding: '16px 0' }}>
          데이터 수집 대기 중
        </p>
      </div>
    )
  }

  const groups = [
    {
      label: '정확도',
      items: [
        { label: 'Accuracy', value: `${(metrics.accuracy * 100).toFixed(1)}%`, color: t.colors.success },
        { label: 'F1', value: `${(metrics.f1 * 100).toFixed(1)}%`, color: t.colors.info },
        { label: 'Precision', value: `${(metrics.precision * 100).toFixed(1)}%`, color: '#a78bfa' },
        { label: 'Recall', value: `${(metrics.recall * 100).toFixed(1)}%`, color: t.colors.warning },
      ],
    },
    {
      label: '레이턴시',
      items: [
        { label: 'Avg', value: `${metrics.avg_latency_ms.toFixed(1)}ms`, color: '#fb923c' },
        { label: 'P95', value: `${metrics.p95_latency_ms.toFixed(1)}ms`, color: t.colors.danger },
      ],
    },
    {
      label: '파이프라인',
      items: [
        { label: 'Gate Pass', value: `${(metrics.gate_pass_rate * 100).toFixed(1)}%`, color: '#22d3ee' },
        { label: 'AL Queue', value: `${metrics.al_queue_size}`, color: '#f472b6' },
        { label: 'Confirmed', value: `${metrics.confirmed_count}`, color: t.colors.success },
      ],
    },
  ]

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div style={t.sectionHeader}>실시간 지표</div>
        <span style={{ fontSize: 10, color: t.colors.textDim, fontFamily: 'monospace' }}>{metrics.window_size}f</span>
      </div>

      {groups.map((group, gi) => (
        <div key={group.label}>
          {gi > 0 && <div style={t.divider} className="my-1.5" />}
          <div style={{ fontSize: 9, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, marginTop: 2 }}>
            {group.label}
          </div>
          {group.items.map(({ label, value, color }) => (
            <div key={label} className="flex justify-between items-center py-0.5">
              <span style={{ fontSize: 11, color: t.colors.textMuted }}>{label}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 500, color }}>{value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
