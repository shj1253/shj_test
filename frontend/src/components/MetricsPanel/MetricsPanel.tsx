import type { MetricsSnapshot } from '../../types'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  metrics: MetricsSnapshot | null
}

function Row({ label, value, color, mono = true }: { label: string; value: string; color?: string; mono?: boolean }) {
  const t = useTheme()
  return (
    <div className="flex justify-between items-center py-0.5">
      <span style={{ fontSize: 10, color: t.colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 10, fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 500, color: color ?? t.colors.text }}>
        {value}
      </span>
    </div>
  )
}

function GroupLabel({ label }: { label: string }) {
  const t = useTheme()
  return (
    <div style={{ fontSize: 8, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 6, marginBottom: 1, fontWeight: 700 }}>
      {label}
    </div>
  )
}

function Divider() {
  const t = useTheme()
  return <div style={{ height: 1, background: t.colors.border, margin: '4px 0' }} />
}

function pct(v: number, digits = 1) { return `${(v * 100).toFixed(digits)}%` }
function ms(v: number) { return `${v.toFixed(1)}ms` }
function num(v: number, digits = 3) { return v.toFixed(digits) }

export default function MetricsPanel({ metrics: m }: Props) {
  const t = useTheme()

  if (!m) {
    return (
      <div className="p-3">
        <div style={t.sectionHeader} className="mb-2">실시간 지표</div>
        <p style={{ fontSize: 10, color: t.colors.textDim, textAlign: 'center', padding: '12px 0' }}>
          데이터 수집 대기 중
        </p>
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-1">
        <div style={t.sectionHeader}>실시간 지표</div>
        <span style={{ fontSize: 9, color: t.colors.textDim, fontFamily: 'monospace' }}>{m.window_size}f</span>
      </div>

      {/* ── Stage 2: 이상 탐지 ── */}
      <GroupLabel label="이상 탐지 (Gate)" />
      <Row label="통과율" value={pct(m.gate_pass_rate)}
           color={m.gate_pass_rate >= 0.10 && m.gate_pass_rate <= 0.40 ? t.colors.success : t.colors.warning} />
      <Row label="OOD Recall" value={pct(m.ood_recall)}
           color={m.ood_recall >= 0.98 ? t.colors.success : m.ood_recall > 0 ? t.colors.warning : t.colors.textDim} />
      <Row label="AUROC" value={m.auroc > 0 ? num(m.auroc, 3) : '--'}
           color={m.auroc >= 0.95 ? t.colors.success : m.auroc > 0 ? t.colors.warning : t.colors.textDim} />
      <Row label="Gate Avg" value={ms(m.gate_latency_avg_ms)} />
      <Row label="Gate P95" value={ms(m.gate_latency_p95_ms)}
           color={m.gate_latency_p95_ms <= 10 ? t.colors.success : t.colors.warning} />

      <Divider />

      {/* ── Stage 3: 분류 ── */}
      <GroupLabel label="분류 (Classifier)" />
      <Row label="Macro F1" value={pct(m.f1)}
           color={m.f1 >= 0.95 ? t.colors.success : m.f1 >= 0.85 ? t.colors.warning : t.colors.danger} />
      <Row label="Accuracy" value={pct(m.accuracy)} color={t.colors.success} />
      <Row label="Precision" value={pct(m.precision)} />
      <Row label="Recall" value={pct(m.recall)} />
      <Row label="ECE" value={m.ece > 0 ? num(m.ece, 4) : '--'}
           color={m.ece <= 0.05 ? t.colors.success : m.ece > 0 ? t.colors.danger : t.colors.textDim} />
      <Row label="낮은신뢰도" value={pct(m.low_confidence_ratio)}
           color={m.low_confidence_ratio <= 0.05 ? t.colors.success : t.colors.warning} />
      <Row label="Cls Avg" value={ms(m.classify_latency_avg_ms)} />
      <Row label="Cls P95" value={ms(m.classify_latency_p95_ms)}
           color={m.classify_latency_p95_ms <= 50 ? t.colors.success : t.colors.warning} />

      {/* 클래스별 F1 */}
      {m.per_class_f1.length > 0 && (
        <>
          <div style={{ fontSize: 8, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 4, marginBottom: 2, fontWeight: 700 }}>
            클래스별 F1
          </div>
          <div className="flex gap-1">
            {m.per_class_f1.map((v, i) => (
              <div key={i} className="flex-1 text-center">
                <div style={{ fontSize: 8, color: t.colors.textDim }}>T{i + 1}</div>
                <div style={{
                  fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                  color: v >= 0.95 ? t.colors.success : v >= 0.85 ? t.colors.warning : t.colors.danger,
                }}>
                  {(v * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* CM 대각비율 */}
      {m.cm_diagonal_ratio.length > 0 && (
        <>
          <div style={{ fontSize: 8, color: t.colors.textDim, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 4, marginBottom: 2, fontWeight: 700 }}>
            CM 대각 비율
          </div>
          <div className="flex gap-1">
            {m.cm_diagonal_ratio.map((v, i) => (
              <div key={i} className="flex-1 text-center">
                <div style={{ fontSize: 8, color: t.colors.textDim }}>T{i + 1}</div>
                <div style={{
                  fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                  color: v >= 0.93 ? t.colors.success : v >= 0.85 ? t.colors.warning : t.colors.danger,
                }}>
                  {(v * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Divider />

      {/* ── Stage 4: State Machine ── */}
      <GroupLabel label="State Machine" />
      <Row label="순서 오류율" value={pct(m.sequence_error_rate, 2)}
           color={m.sequence_error_rate <= 0.01 ? t.colors.success : t.colors.danger} />
      <Row label="False Block" value={pct(m.false_block_rate, 2)}
           color={m.false_block_rate <= 0.005 ? t.colors.success : t.colors.danger} />
      <Row label="완주율" value={m.sequence_completion_rate > 0 ? pct(m.sequence_completion_rate) : '--'}
           color={m.sequence_completion_rate >= 0.99 ? t.colors.success : t.colors.warning} />
      <Row label="E2E 지연" value={m.e2e_latency_ms > 0 ? ms(m.e2e_latency_ms) : '--'}
           color={m.e2e_latency_ms <= 200 ? t.colors.success : t.colors.warning} />
      <Row label="시스템 정밀도" value={m.system_precision > 0 ? pct(m.system_precision) : '--'}
           color={m.system_precision >= 0.99 ? t.colors.success : t.colors.warning} />

      <Divider />

      {/* ── 전체 레이턴시 ── */}
      <GroupLabel label="전체 레이턴시" />
      <Row label="Total Avg" value={ms(m.avg_latency_ms)} />
      <Row label="Total P95" value={ms(m.p95_latency_ms)}
           color={m.p95_latency_ms <= 100 ? t.colors.success : t.colors.warning} />

      <Divider />

      {/* ── Active Learning ── */}
      <GroupLabel label="Active Learning" />
      <Row label="AL Queue" value={`${m.al_queue_size}`} color={'#f472b6'} />
      <Row label="Confirmed" value={`${m.confirmed_count}`} color={t.colors.success} />
      <Row label="쿼리 적중률" value={m.al_query_hit_rate > 0 ? pct(m.al_query_hit_rate) : '--'}
           color={m.al_query_hit_rate >= 0.5 ? t.colors.success : m.al_query_hit_rate > 0 ? t.colors.warning : t.colors.textDim} />
      <Row label="PSI (드리프트)" value={m.psi_score > 0 ? num(m.psi_score, 3) : '--'}
           color={m.psi_score > 0.2 ? t.colors.danger : m.psi_score > 0.1 ? t.colors.warning : t.colors.success} />
      {m.psi_score > 0.2 && (
        <div style={{ fontSize: 9, color: t.colors.danger, background: t.colors.danger + '15', padding: '2px 4px', borderRadius: 2, marginTop: 2 }}>
          ⚠ 드리프트 감지 — 재학습 권장
        </div>
      )}
    </div>
  )
}
