import { useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useWebSocket } from '../api/wsClient'
import { useMetricsStore } from '../store'
import type { MetricsSnapshot } from '../types'

export default function MetricsPage() {
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

  const METRICS_CARDS = current
    ? [
        { label: 'Accuracy', value: `${(current.accuracy * 100).toFixed(1)}%`, color: 'text-emerald-400' },
        { label: 'F1 (macro)', value: `${(current.f1 * 100).toFixed(1)}%`, color: 'text-blue-400' },
        { label: 'Precision', value: `${(current.precision * 100).toFixed(1)}%`, color: 'text-violet-400' },
        { label: 'Recall', value: `${(current.recall * 100).toFixed(1)}%`, color: 'text-amber-400' },
        { label: 'Avg Latency', value: `${current.avg_latency_ms.toFixed(1)}ms`, color: 'text-orange-400' },
        { label: 'P95 Latency', value: `${current.p95_latency_ms.toFixed(1)}ms`, color: 'text-red-400' },
        { label: 'Gate Pass', value: `${(current.gate_pass_rate * 100).toFixed(1)}%`, color: 'text-cyan-400' },
        { label: 'AL Queue', value: `${current.al_queue_size}`, color: 'text-pink-400' },
        { label: 'Confirmed', value: `${current.confirmed_count}`, color: 'text-emerald-400' },
      ]
    : []

  const chartStyle = {
    grid: '#1a2332',
    tick: { fontSize: 10, fill: '#64748b' },
    tooltip: { background: '#111827', border: '1px solid #1e293b', fontSize: 11 },
  }

  return (
    <div className="p-5 space-y-4">
      {/* 지표 카드 */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {METRICS_CARDS.map(({ label, value, color }) => (
          <div key={label} className="panel p-3 text-center">
            <p className="text-[10px] text-slate-500 mb-1">{label}</p>
            <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
          </div>
        ))}
        {!current && (
          <div className="col-span-full text-center text-slate-600 py-8 text-xs">
            메트릭 데이터 수집 대기 중
          </div>
        )}
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="panel p-4">
          <h3 className="panel-header mb-4">Accuracy / F1 Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartStyle.grid} />
              <XAxis dataKey="t" tick={chartStyle.tick} />
              <YAxis domain={[0, 100]} tick={chartStyle.tick} />
              <Tooltip contentStyle={chartStyle.tooltip} />
              <Line type="monotone" dataKey="accuracy" stroke="#34d399" dot={false} strokeWidth={1.5} name="Accuracy" />
              <Line type="monotone" dataKey="f1" stroke="#60a5fa" dot={false} strokeWidth={1.5} name="F1" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel p-4">
          <h3 className="panel-header mb-4">Latency Trend (ms)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartStyle.grid} />
              <XAxis dataKey="t" tick={chartStyle.tick} />
              <YAxis tick={chartStyle.tick} />
              <Tooltip contentStyle={chartStyle.tooltip} />
              <Line type="monotone" dataKey="latency" stroke="#fb923c" dot={false} strokeWidth={1.5} name="Avg Latency" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel p-4">
          <h3 className="panel-header mb-4">Gate Pass Rate</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartStyle.grid} />
              <XAxis dataKey="t" tick={chartStyle.tick} />
              <YAxis domain={[0, 100]} tick={chartStyle.tick} />
              <Tooltip contentStyle={chartStyle.tooltip} />
              <Line type="monotone" dataKey="gate_pass" stroke="#22d3ee" dot={false} strokeWidth={1.5} name="Gate Pass%" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Confusion Matrix */}
        <div className="panel p-4">
          <h3 className="panel-header mb-4">Confusion Matrix</h3>
          {current?.confusion_matrix && current.confusion_matrix.length > 0 ? (
            <div className="inline-grid gap-0.5 text-center text-[11px]"
                 style={{ gridTemplateColumns: `40px repeat(${current.confusion_matrix.length}, 1fr)` }}>
              <div />
              {current.confusion_matrix.map((_, i) => (
                <div key={`h-${i}`} className="text-slate-500 font-mono font-medium py-1 px-2">T{i + 1}</div>
              ))}
              {current.confusion_matrix.map((row, i) => (
                <>
                  <div key={`l-${i}`} className="text-slate-500 font-mono font-medium flex items-center justify-center">T{i + 1}</div>
                  {row.map((val, j) => (
                    <div
                      key={`${i}-${j}`}
                      className={`py-1.5 px-2 rounded font-mono ${
                        i === j
                          ? val > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#0f172a] text-slate-600'
                          : val > 0 ? 'bg-red-500/15 text-red-400' : 'bg-[#0f172a] text-slate-700'
                      }`}
                    >
                      {val}
                    </div>
                  ))}
                </>
              ))}
            </div>
          ) : (
            <div className="text-center text-slate-600 py-8 text-xs">
              데이터 수집 후 표시됩니다
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
