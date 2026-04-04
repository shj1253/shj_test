import { useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useWebSocket } from '../api/wsClient'
import { useMetricsStore } from '../store'
import type { MetricsSnapshot } from '../types'
import { useTheme } from '../hooks/useTheme'

export default function MetricsPage() {
  const t = useTheme()
  const { current, history, updateMetrics } = useMetricsStore()

  const handleMetrics = useCallback((data: unknown) => {
    updateMetrics(data as MetricsSnapshot)
  }, [updateMetrics])

  useWebSocket('metrics', handleMetrics)

  const chartData = history.map((s, i) => ({
    t: i,
    accuracy: +(s.accuracy * 100).toFixed(1),
    f1: +(s.f1 * 100).toFixed(1),
    latency: +s.avg_latency_ms.toFixed(1),
    gate_pass: +(s.gate_pass_rate * 100).toFixed(1),
  }))

  const CARDS = current ? [
    { label: 'Accuracy', value: `${(current.accuracy * 100).toFixed(1)}%`, color: t.colors.success },
    { label: 'F1', value: `${(current.f1 * 100).toFixed(1)}%`, color: t.colors.info },
    { label: 'Precision', value: `${(current.precision * 100).toFixed(1)}%`, color: '#a78bfa' },
    { label: 'Recall', value: `${(current.recall * 100).toFixed(1)}%`, color: t.colors.warning },
    { label: 'Latency', value: `${current.avg_latency_ms.toFixed(1)}ms`, color: '#fb923c' },
    { label: 'P95', value: `${current.p95_latency_ms.toFixed(1)}ms`, color: t.colors.danger },
    { label: 'Gate', value: `${(current.gate_pass_rate * 100).toFixed(1)}%`, color: '#22d3ee' },
    { label: 'AL', value: `${current.al_queue_size}`, color: '#f472b6' },
    { label: 'Confirmed', value: `${current.confirmed_count}`, color: t.colors.success },
  ] : []

  const chartTick = { fontSize: 10, fill: t.colors.textDim }
  const chartTooltip = { background: t.colors.bgPanel, border: `1px solid ${t.colors.border}`, fontSize: 11, color: t.colors.text }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Cards */}
      <div className="grid grid-cols-9 gap-1.5">
        {CARDS.map(({ label, value, color }) => (
          <div key={label} className="rounded p-2 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
            <p style={{ fontSize: 9, color: t.colors.textDim, marginBottom: 2 }}>{label}</p>
            <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color }}>{value}</p>
          </div>
        ))}
        {!current && (
          <div className="col-span-9 text-center py-6" style={{ fontSize: 11, color: t.colors.textDim }}>
            메트릭 데이터 수집 대기 중
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard t={t} title="Accuracy / F1">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
              <XAxis dataKey="t" tick={chartTick} />
              <YAxis domain={[0, 100]} tick={chartTick} />
              <Tooltip contentStyle={chartTooltip} />
              <Line type="monotone" dataKey="accuracy" stroke={t.colors.success} dot={false} strokeWidth={1.5} name="Accuracy" />
              <Line type="monotone" dataKey="f1" stroke={t.colors.info} dot={false} strokeWidth={1.5} name="F1" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard t={t} title="Latency (ms)">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
              <XAxis dataKey="t" tick={chartTick} />
              <YAxis tick={chartTick} />
              <Tooltip contentStyle={chartTooltip} />
              <Line type="monotone" dataKey="latency" stroke="#fb923c" dot={false} strokeWidth={1.5} name="Avg Latency" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard t={t} title="Gate Pass Rate">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
              <XAxis dataKey="t" tick={chartTick} />
              <YAxis domain={[0, 100]} tick={chartTick} />
              <Tooltip contentStyle={chartTooltip} />
              <Line type="monotone" dataKey="gate_pass" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="Gate Pass%" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Confusion Matrix */}
        <ChartCard t={t} title="Confusion Matrix">
          {current?.confusion_matrix && current.confusion_matrix.length > 0 ? (
            <div className="inline-grid gap-px" style={{ gridTemplateColumns: `32px repeat(${current.confusion_matrix.length}, 1fr)` }}>
              <div />
              {current.confusion_matrix.map((_, i) => (
                <div key={`h-${i}`} style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textMuted, textAlign: 'center', padding: 4 }}>T{i + 1}</div>
              ))}
              {current.confusion_matrix.map((row, i) => (
                <>
                  <div key={`l-${i}`} className="flex items-center justify-center" style={{ fontSize: 10, fontFamily: 'monospace', color: t.colors.textMuted }}>T{i + 1}</div>
                  {row.map((val, j) => (
                    <div key={`${i}-${j}`} className="text-center rounded" style={{
                      padding: 4,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      background: i === j ? (val > 0 ? t.colors.success + '20' : t.colors.bgInput) : (val > 0 ? t.colors.danger + '20' : t.colors.bgInput),
                      color: i === j ? (val > 0 ? t.colors.success : t.colors.textDim) : (val > 0 ? t.colors.danger : t.colors.textDim),
                    }}>
                      {val}
                    </div>
                  ))}
                </>
              ))}
            </div>
          ) : (
            <div className="text-center py-6" style={{ fontSize: 11, color: t.colors.textDim }}>
              데이터 수집 후 표시됩니다
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function ChartCard({ t, title, children }: { t: ReturnType<typeof useTheme>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
      <div style={t.sectionHeader} className="mb-3">{title}</div>
      {children}
    </div>
  )
}
