import { useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend
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
        { label: 'Accuracy', value: `${(current.accuracy * 100).toFixed(1)}%`, color: 'text-green-400' },
        { label: 'F1 (macro)', value: `${(current.f1 * 100).toFixed(1)}%`, color: 'text-blue-400' },
        { label: 'Precision', value: `${(current.precision * 100).toFixed(1)}%`, color: 'text-purple-400' },
        { label: 'Recall', value: `${(current.recall * 100).toFixed(1)}%`, color: 'text-yellow-400' },
        { label: 'Avg Latency', value: `${current.avg_latency_ms.toFixed(1)}ms`, color: 'text-orange-400' },
        { label: 'P95 Latency', value: `${current.p95_latency_ms.toFixed(1)}ms`, color: 'text-red-400' },
        { label: 'Gate 통과율', value: `${(current.gate_pass_rate * 100).toFixed(1)}%`, color: 'text-cyan-400' },
        { label: 'AL 큐', value: `${current.al_queue_size}건`, color: 'text-pink-400' },
        { label: '확정 건수', value: `${current.confirmed_count}건`, color: 'text-emerald-400' },
      ]
    : []

  return (
    <div className="p-6 space-y-6">
      {/* 지표 카드 */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
        {METRICS_CARDS.map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 rounded-xl p-3 border border-gray-800 text-center">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
          </div>
        ))}
        {!current && (
          <div className="col-span-full text-center text-gray-600 py-8 text-sm">
            메트릭 데이터 수집 중...
          </div>
        )}
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-2 gap-6">
        {/* 정확도/F1 트렌드 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">정확도 / F1 트렌드 (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="accuracy" stroke="#34d399" dot={false} strokeWidth={2} name="Accuracy" />
              <Line type="monotone" dataKey="f1" stroke="#60a5fa" dot={false} strokeWidth={2} name="F1" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 레이턴시 트렌드 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">레이턴시 트렌드 (ms)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="latency" stroke="#fb923c" dot={false} strokeWidth={2} name="Avg Latency" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gate 통과율 */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">Gate 통과율 (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="gate_pass" stroke="#22d3ee" dot={false} strokeWidth={2} name="Gate Pass%" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Confusion Matrix */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">혼동 행렬</h3>
          {current?.confusion_matrix && current.confusion_matrix.length > 0 ? (
            <div className="grid grid-cols-5 gap-1 text-center text-xs">
              <div className="text-gray-500" />
              {['T1', 'T2', 'T3', 'T4'].map(t => (
                <div key={t} className="text-gray-400 font-medium py-1">{t}</div>
              ))}
              {current.confusion_matrix.map((row, i) => (
                <>
                  <div key={`label-${i}`} className="text-gray-400 font-medium flex items-center justify-center">T{i + 1}</div>
                  {row.map((val, j) => (
                    <div
                      key={`${i}-${j}`}
                      className={`py-2 rounded text-sm font-mono ${
                        i === j
                          ? val > 0 ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'
                          : val > 0 ? 'bg-red-900 text-red-300' : 'bg-gray-800 text-gray-600'
                      }`}
                    >
                      {val}
                    </div>
                  ))}
                </>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-600 py-8 text-sm">
              레이블 데이터가 있을 때 표시됩니다
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
