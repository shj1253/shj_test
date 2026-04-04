import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, Upload, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { useWebSocket } from '../api/wsClient'
import { useMetricsStore } from '../store'
import { api } from '../api/httpClient'
import { useTheme } from '../hooks/useTheme'
import type { KpiEntry, KpiReport, KpiStatus, MetricsSnapshot } from '../types'

// ── KPI 상태 색상 ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<KpiStatus, string> = {
  pass: '#22c55e',
  warn: '#f59e0b',
  fail: '#ef4444',
  na:   '#6b7280',
}
const STATUS_LABEL: Record<KpiStatus, string> = {
  pass: 'PASS', warn: 'WARN', fail: 'FAIL', na: 'N/A',
}
const PRIORITY_LABEL: Record<number, string> = { 1: '1순위', 2: '2순위', 0: '참고' }

const STAGE_META = [
  { key: 'stage1', label: '1단계: 데이터 증강',         tag: 'Data Augmentation', color: '#a78bfa' },
  { key: 'stage2', label: '2단계: 이상 탐지',           tag: 'Anomaly Detection',  color: '#22d3ee' },
  { key: 'stage3', label: '3단계: 분류 (T1~T4)',        tag: 'Classification',     color: '#fb923c' },
  { key: 'stage4', label: '4단계: 상태 기계 (순서 검증)', tag: 'State Machine',     color: '#4ade80' },
  { key: 'al',     label: '지속: Active Learning',      tag: 'AL',                 color: '#f472b6' },
]

// ── KPI 카드 ────────────────────────────────────────────────────────────────

function KpiCard({ kpi, t }: { kpi: KpiEntry; t: ReturnType<typeof useTheme> }) {
  const [tip, setTip] = useState(false)
  const color = STATUS_COLOR[kpi.status]

  return (
    <div
      className="rounded p-2.5 relative"
      style={{
        background: t.colors.bgPanel,
        border: `1px solid ${kpi.status === 'fail' ? color + '60' : t.colors.border}`,
        outline: kpi.status === 'fail' ? `1px solid ${color}30` : 'none',
      }}
    >
      {/* Priority badge */}
      {kpi.priority === 1 && (
        <span style={{
          position: 'absolute', top: 6, right: 6,
          fontSize: 8, fontWeight: 700, color: t.colors.accent,
          background: t.colors.accent + '18',
          padding: '1px 4px', borderRadius: 2,
        }}>
          1순위
        </span>
      )}

      {/* Label */}
      <div className="flex items-center gap-1 mb-1.5" style={{ paddingRight: kpi.priority === 1 ? 36 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: t.colors.textMuted, lineHeight: 1.3 }}>
          {kpi.label}
        </span>
        {kpi.need_gt && (
          <div className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
            <Info size={9} style={{ color: t.colors.textDim, cursor: 'help' }} />
            {tip && (
              <div className="absolute z-50 bottom-full left-0 mb-1 w-40 rounded px-2 py-1.5 shadow-lg"
                   style={{ background: t.colors.bgActivityBar, border: `1px solid ${t.colors.border}`, fontSize: 9, color: t.colors.textMuted, whiteSpace: 'normal' }}>
                GT(정답 레이블) 필요 — 테스트 추론 또는 평가 데이터셋으로 측정
              </div>
            )}
          </div>
        )}
      </div>

      {/* Value */}
      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color, lineHeight: 1 }}>
        {kpi.display}
      </div>

      {/* Target + Status */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <span style={{
          fontSize: 8, fontWeight: 700, color,
          background: color + '15',
          border: `1px solid ${color}30`,
          padding: '1px 4px', borderRadius: 2,
        }}>
          {STATUS_LABEL[kpi.status]}
        </span>
        <span style={{ fontSize: 9, color: t.colors.textDim }}>목표 {kpi.target}</span>
      </div>
    </div>
  )
}

// ── 단계 섹션 ───────────────────────────────────────────────────────────────

function StageSection({
  stageKey, label, tag, color, kpis, t
}: {
  stageKey: string; label: string; tag: string; color: string
  kpis: KpiEntry[]; t: ReturnType<typeof useTheme>
}) {
  const [open, setOpen] = useState(true)
  const pass = kpis.filter(k => k.status === 'pass').length
  const fail = kpis.filter(k => k.status === 'fail').length
  const warn = kpis.filter(k => k.status === 'warn').length
  const na   = kpis.filter(k => k.status === 'na').length

  return (
    <div className="rounded overflow-hidden" style={{ border: `1px solid ${t.colors.border}` }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        style={{ background: t.colors.bgPanel, borderBottom: open ? `1px solid ${t.colors.border}` : 'none' }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={13} style={{ color: t.colors.textDim }} />
               : <ChevronRight size={13} style={{ color: t.colors.textDim }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: t.colors.textHeading }}>{label}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, color,
          background: color + '18',
          border: `1px solid ${color}30`,
          padding: '1px 6px', borderRadius: 3, marginLeft: 2,
        }}>{tag}</span>

        {/* Mini summary */}
        <div className="ml-auto flex items-center gap-1.5">
          {pass > 0 && <Pill label={`${pass} PASS`} color={STATUS_COLOR.pass} />}
          {warn > 0 && <Pill label={`${warn} WARN`} color={STATUS_COLOR.warn} />}
          {fail > 0 && <Pill label={`${fail} FAIL`} color={STATUS_COLOR.fail} />}
          {na   > 0 && <Pill label={`${na} N/A`}   color={STATUS_COLOR.na}   />}
        </div>
      </div>

      {/* KPI grid */}
      {open && (
        <div className="p-3" style={{ background: t.colors.bgBase }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {kpis.map(k => <KpiCard key={k.key} kpi={k} t={t} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, color,
      background: color + '15', border: `1px solid ${color}30`,
      padding: '1px 5px', borderRadius: 2,
    }}>{label}</span>
  )
}

// ── Confusion Matrix ────────────────────────────────────────────────────────

function ConfusionMatrix({ cm, t }: { cm: number[][]; t: ReturnType<typeof useTheme> }) {
  if (!cm || cm.length === 0) return (
    <div style={{ fontSize: 11, color: t.colors.textDim, textAlign: 'center', padding: 20 }}>
      GT 데이터 수집 후 표시됩니다
    </div>
  )
  const n = cm.length
  return (
    <div>
      <div className="inline-grid gap-px" style={{ gridTemplateColumns: `28px repeat(${n}, 1fr)` }}>
        <div />
        {cm.map((_, i) => (
          <div key={i} style={{ fontSize: 9, fontFamily: 'monospace', color: t.colors.textDim, textAlign: 'center', padding: '2px 4px', fontWeight: 700 }}>
            T{i + 1}
          </div>
        ))}
        {cm.map((row, i) => (
          <>
            <div key={`l${i}`} style={{ fontSize: 9, fontFamily: 'monospace', color: t.colors.textDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              T{i + 1}
            </div>
            {row.map((val, j) => {
              const isDiag = i === j
              const rowSum = row.reduce((a, b) => a + b, 0)
              const pct = rowSum > 0 ? val / rowSum : 0
              const bg = isDiag
                ? `rgba(34,197,94,${Math.max(0.05, pct * 0.4)})`
                : val > 0 ? `rgba(239,68,68,${Math.min(0.5, pct * 0.6)})` : t.colors.bgInput
              return (
                <div key={j} style={{
                  padding: '4px 2px', textAlign: 'center', borderRadius: 2,
                  fontSize: 11, fontFamily: 'monospace',
                  background: bg,
                  color: isDiag ? '#22c55e' : val > 0 ? '#ef4444' : t.colors.textDim,
                  fontWeight: isDiag ? 700 : 400,
                }}>
                  {val}
                  {rowSum > 0 && <span style={{ fontSize: 8, opacity: 0.7 }}> {(pct * 100).toFixed(0)}%</span>}
                </div>
              )
            })}
          </>
        ))}
      </div>
      <div style={{ fontSize: 9, color: t.colors.textDim, marginTop: 6 }}>행=실제(GT), 열=예측</div>
    </div>
  )
}

// ── 오프라인 지표 입력 모달 ────────────────────────────────────────────────

function OfflineMetricsPanel({ t }: { t: ReturnType<typeof useTheme> }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ coverage_diversity: '', fid_score: '', downstream_f1_gain: '' })
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle')

  const handleSubmit = async () => {
    const data: Record<string, number> = {}
    for (const [k, v] of Object.entries(values)) {
      const n = parseFloat(v)
      if (!isNaN(n)) data[k] = n
    }
    if (Object.keys(data).length === 0) return
    try {
      await api.setOfflineMetrics(data)
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('err')
    }
  }

  return (
    <div className="rounded" style={{ border: `1px solid ${t.colors.border}`, background: t.colors.bgPanel }}>
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <Upload size={12} style={{ color: t.colors.accent }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.text }}>오프라인 측정값 등록</span>
        <span style={{ fontSize: 10, color: t.colors.textDim, marginLeft: 4 }}>FID, 커버리지 다양성 등 학습 후 측정 지표</span>
        {open ? <ChevronDown size={12} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />
               : <ChevronRight size={12} style={{ color: t.colors.textDim, marginLeft: 'auto' }} />}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${t.colors.border}` }}>
          <p style={{ fontSize: 10, color: t.colors.textDim, paddingTop: 8 }}>
            데이터 증강 실험 후 수동으로 입력하세요. 입력하면 KPI 리포트에 반영됩니다.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'coverage_diversity', label: '커버리지 다양성', placeholder: '0.0 ~ 1.0' },
              { key: 'fid_score',          label: 'FID 점수',        placeholder: '낮을수록 좋음' },
              { key: 'downstream_f1_gain', label: 'Downstream F1 향상률', placeholder: '0.05 = +5%' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={{ fontSize: 10, color: t.colors.textMuted, display: 'block', marginBottom: 2 }}>{label}</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder={placeholder}
                  value={values[key as keyof typeof values]}
                  onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                  style={{ ...t.input, width: '100%', fontSize: 11 }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSubmit} style={t.btnPrimary}>등록</button>
            {status === 'ok' && <span style={{ fontSize: 11, color: STATUS_COLOR.pass }}>저장됨</span>}
            {status === 'err' && <span style={{ fontSize: 11, color: STATUS_COLOR.fail }}>오류</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 MetricsPage ────────────────────────────────────────────────────────

export default function MetricsPage() {
  const t = useTheme()
  const { current, history, updateMetrics } = useMetricsStore()
  const [kpi, setKpi] = useState<KpiReport | null>(null)
  const [activeTab, setActiveTab] = useState<'kpi' | 'chart'>('kpi')
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 실시간 메트릭 구독
  useWebSocket('metrics', useCallback((data: unknown) => {
    updateMetrics(data as MetricsSnapshot)
  }, [updateMetrics]))

  // KPI 리포트 폴링 (10초)
  const fetchKpi = useCallback(async () => {
    try {
      const res = await api.getKpiReport()
      setKpi(res.data as KpiReport)
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    fetchKpi()
    pollRef.current = setInterval(fetchKpi, 10000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchKpi])

  const handleRefresh = async () => {
    setLoading(true)
    await fetchKpi()
    setLoading(false)
  }

  // 차트 데이터
  const chartData = history.map((s, i) => ({
    t: i,
    f1:          +(s.f1 * 100).toFixed(1),
    accuracy:    +(s.accuracy * 100).toFixed(1),
    gate_pass:   +(s.gate_pass_rate * 100).toFixed(1),
    low_conf:    +(s.low_confidence_ratio * 100).toFixed(1),
    latency:     +s.avg_latency_ms.toFixed(1),
    p95:         +s.p95_latency_ms.toFixed(1),
  }))

  const chartTick = { fontSize: 9, fill: t.colors.textDim }
  const chartTooltip = { background: t.colors.bgPanel, border: `1px solid ${t.colors.border}`, fontSize: 10, color: t.colors.text }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
           style={{ background: t.colors.bgPanel, borderBottom: `1px solid ${t.colors.border}` }}>
        <div className="flex gap-0">
          {(['kpi', 'chart'] as const).map(tabId => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px',
                background: 'transparent', cursor: 'pointer', border: 'none',
                borderBottom: `2px solid ${tabId === activeTab ? t.colors.accent : 'transparent'}`,
                color: tabId === activeTab ? t.colors.accent : t.colors.textMuted,
              }}
            >
              {tabId === 'kpi' ? 'KPI 대시보드' : '실시간 차트'}
            </button>
          ))}
        </div>

        {/* Summary pills */}
        {kpi && (
          <div className="flex items-center gap-1.5 ml-4">
            {(['pass', 'warn', 'fail', 'na'] as const).map(s => (
              <Pill key={s} label={`${kpi.summary[s]} ${STATUS_LABEL[s]}`} color={STATUS_COLOR[s]} />
            ))}
          </div>
        )}

        <button onClick={handleRefresh} style={{ ...t.btnSecondary, marginLeft: 'auto' }}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'kpi' ? (
          <>
            {/* 오프라인 측정값 입력 */}
            <OfflineMetricsPanel t={t} />

            {/* KPI 단계별 섹션 */}
            {kpi ? (
              STAGE_META.map(meta => (
                <StageSection
                  key={meta.key}
                  stageKey={meta.key}
                  label={meta.label}
                  tag={meta.tag}
                  color={meta.color}
                  kpis={kpi.stages[meta.key as keyof typeof kpi.stages]}
                  t={t}
                />
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: t.colors.textDim, fontSize: 12 }}>
                KPI 데이터 로딩 중...
              </div>
            )}

            {/* 단계 간 연결 지표 강조 */}
            <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.accent}30` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.colors.accent, marginBottom: 8 }}>
                단계 간 연결 핵심 지표
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: '2단계 통과율',
                    desc: '10~40% 벗어나면 Anomaly Detection 임계값 오설정 신호',
                    value: current ? `${(current.gate_pass_rate * 100).toFixed(1)}%` : '--',
                    ok: current ? (current.gate_pass_rate >= 0.10 && current.gate_pass_rate <= 0.40) : null,
                  },
                  {
                    label: '3단계 ECE',
                    desc: '과신뢰/과소신뢰 → 4단계 State Machine 오작동으로 직결',
                    value: current ? current.ece.toFixed(3) : '--',
                    ok: current ? current.ece <= 0.05 : null,
                  },
                  {
                    label: '시스템 정밀도 vs 분류기 정밀도',
                    desc: '두 값 차이 = State Machine의 오탐 방어 기여분',
                    value: current ? `${(current.system_precision * 100).toFixed(1)}% vs ${(current.precision * 100).toFixed(1)}%` : '--',
                    ok: current ? current.system_precision >= current.precision : null,
                  },
                ].map(({ label, desc, value, ok }) => (
                  <div key={label} className="rounded p-2.5"
                       style={{ background: t.colors.bgInput, border: `1px solid ${t.colors.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.colors.text, marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace',
                                  color: ok === null ? t.colors.textDim : ok ? STATUS_COLOR.pass : STATUS_COLOR.fail }}>
                      {value}
                    </div>
                    <div style={{ fontSize: 9, color: t.colors.textDim, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* PSI drift 경고 */}
            {current && current.psi_score > 0.2 && (
              <div className="rounded px-3 py-2 flex items-start gap-2"
                   style={{ background: STATUS_COLOR.warn + '15', border: `1px solid ${STATUS_COLOR.warn}40` }}>
                <span style={{ fontSize: 13, color: STATUS_COLOR.warn, flexShrink: 0 }}>⚠</span>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR.warn }}>
                    데이터 드리프트 감지 — PSI {current.psi_score.toFixed(3)}
                  </span>
                  <p style={{ fontSize: 10, color: t.colors.textMuted, marginTop: 2 }}>
                    PSI &gt; 0.2 — 입력 분포가 학습 데이터와 크게 달라졌습니다. 모델 재학습을 권장합니다.
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          /* 차트 탭 */
          <>
            {/* 빠른 현황 카드 */}
            {current && (
              <div className="grid grid-cols-8 gap-1.5">
                {[
                  { l: 'Macro F1',     v: `${(current.f1 * 100).toFixed(1)}%`,    c: '#22d3ee' },
                  { l: 'Accuracy',     v: `${(current.accuracy * 100).toFixed(1)}%`, c: '#22c55e' },
                  { l: 'Gate Pass',    v: `${(current.gate_pass_rate * 100).toFixed(1)}%`, c: '#a78bfa' },
                  { l: 'Low Conf',     v: `${(current.low_confidence_ratio * 100).toFixed(1)}%`, c: '#f59e0b' },
                  { l: 'P95 Lat',      v: `${current.p95_latency_ms.toFixed(1)}ms`, c: '#fb923c' },
                  { l: 'Seq Error',    v: `${(current.sequence_error_rate * 100).toFixed(2)}%`, c: '#ef4444' },
                  { l: 'AL Queue',     v: `${current.al_queue_size}`,               c: '#f472b6' },
                  { l: 'Confirmed',    v: `${current.confirmed_count}`,             c: '#22c55e' },
                ].map(({ l, v, c }) => (
                  <div key={l} className="rounded p-2 text-center" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
                    <p style={{ fontSize: 9, color: t.colors.textDim, marginBottom: 2 }}>{l}</p>
                    <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: c }}>{v}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <ChartCard t={t} title="F1 / Accuracy">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
                    <XAxis dataKey="t" tick={chartTick} />
                    <YAxis domain={[0, 100]} tick={chartTick} />
                    <Tooltip contentStyle={chartTooltip} />
                    <Line type="monotone" dataKey="f1"       stroke="#22d3ee" dot={false} strokeWidth={1.5} name="Macro F1 %" />
                    <Line type="monotone" dataKey="accuracy" stroke="#22c55e" dot={false} strokeWidth={1.5} name="Accuracy %" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard t={t} title="Gate 통과율 / 낮은 신뢰도 비율">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
                    <XAxis dataKey="t" tick={chartTick} />
                    <YAxis domain={[0, 100]} tick={chartTick} />
                    <Tooltip contentStyle={chartTooltip} />
                    <Line type="monotone" dataKey="gate_pass" stroke="#a78bfa" dot={false} strokeWidth={1.5} name="Gate Pass %" />
                    <Line type="monotone" dataKey="low_conf"  stroke="#f59e0b" dot={false} strokeWidth={1.5} name="Low Conf %" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard t={t} title="레이턴시 (ms)">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
                    <XAxis dataKey="t" tick={chartTick} />
                    <YAxis tick={chartTick} />
                    <Tooltip contentStyle={chartTooltip} />
                    <Line type="monotone" dataKey="latency" stroke="#fb923c" dot={false} strokeWidth={1.5} name="Avg Latency" />
                    <Line type="monotone" dataKey="p95"     stroke="#ef4444" dot={false} strokeWidth={1.5} name="P95 Latency" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard t={t} title="Confusion Matrix">
                <ConfusionMatrix cm={current?.confusion_matrix ?? []} t={t} />
              </ChartCard>
            </div>

            {/* Per-class F1 */}
            {current && current.per_class_f1.length > 0 && (
              <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
                <div style={t.sectionHeader} className="mb-2">클래스별 F1</div>
                <div className="flex gap-3">
                  {current.per_class_f1.map((v, i) => (
                    <div key={i} className="flex-1 text-center">
                      <div style={{ fontSize: 10, color: t.colors.textDim, marginBottom: 2 }}>T{i + 1}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                                    color: v >= 0.95 ? STATUS_COLOR.pass : v >= 0.85 ? STATUS_COLOR.warn : STATUS_COLOR.fail }}>
                        {(v * 100).toFixed(1)}%
                      </div>
                      {/* Bar */}
                      <div className="mt-1 rounded-sm overflow-hidden" style={{ height: 4, background: t.colors.bgInput }}>
                        <div style={{ height: '100%', width: `${v * 100}%`, background: v >= 0.95 ? STATUS_COLOR.pass : v >= 0.85 ? STATUS_COLOR.warn : STATUS_COLOR.fail, transition: 'width 0.5s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ChartCard({ t, title, children }: { t: ReturnType<typeof useTheme>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-3" style={{ background: t.colors.bgPanel, border: `1px solid ${t.colors.border}` }}>
      <div style={t.sectionHeader} className="mb-2">{title}</div>
      {children}
    </div>
  )
}
