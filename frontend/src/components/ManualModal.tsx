/**
 * ManualModal — 비전공자 대상 단계별 운용 설명서
 * Layout 상단 도움말(?) 버튼에서 열림
 */
import { useState } from 'react'
import {
  X, Camera, AlertTriangle, BarChart3, Tags,
  CheckCircle2, ChevronRight, Volume2, Wifi, WifiOff,
  Eye, RefreshCw, RotateCcw, Info,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

// ── 단계 정의 ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 1,
    title: '시스템 시작하기',
    subtitle: '카메라 또는 영상 파일 연결',
    icon: Camera,
    color: '#3b82f6',
  },
  {
    id: 2,
    title: '실시간 화면 보는 법',
    subtitle: '탐지 단계(T1~T4) 이해',
    icon: Eye,
    color: '#10b981',
  },
  {
    id: 3,
    title: '알림 이해하기',
    subtitle: '경보 내용·긴급도·조치 방법',
    icon: AlertTriangle,
    color: '#f59e0b',
  },
  {
    id: 4,
    title: '성능 지표 화면',
    subtitle: '초록/노랑/빨강 신호 읽는 법',
    icon: BarChart3,
    color: '#8b5cf6',
  },
  {
    id: 5,
    title: 'AL 레이블링',
    subtitle: '화면 속 Target 화면 종류 직접 선택',
    icon: Tags,
    color: '#ec4899',
  },
  {
    id: 6,
    title: '문제 발생 시',
    subtitle: '오류 대응 및 자주 묻는 질문',
    icon: Info,
    color: '#ef4444',
  },
]

// ── 각 단계 내용 ──────────────────────────────────────────────────────────

function Step1({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        시스템을 켜면 처음엔 아무것도 안 나옵니다. 아래 순서대로 시작하세요.
      </p>

      <Section title="카메라로 시작하는 경우" color="#3b82f6" t={t}>
        <Step num={1} t={t}>상단 탭에서 <Bold>실시간</Bold> → 왼쪽 메뉴에서 <Bold>실시간 검출</Bold>을 누릅니다.</Step>
        <Step num={2} t={t}>화면 왼쪽에서 <Bold>장치 번호</Bold>를 확인합니다 (보통 <Bold>0</Bold>번).</Step>
        <Step num={3} t={t}><Bold>카메라 시작</Bold> 버튼을 한 번 누릅니다. 버튼이 "시작 중..."으로 바뀌면 기다립니다.</Step>
        <Step num={4} t={t}>화면에 카메라 영상이 나타나면 시작된 것입니다.</Step>
      </Section>

      <Section title="영상 파일로 시작하는 경우" color="#6366f1" t={t}>
        <Step num={1} t={t}><Bold>파일 경로</Bold> 입력란에 영상 파일 위치를 입력합니다.</Step>
        <Step num={2} t={t}>반복 재생이 필요하면 <Bold>루프</Bold> 체크를 켭니다.</Step>
        <Step num={3} t={t}><Bold>파일 시작</Bold> 버튼을 누릅니다.</Step>
      </Section>

      <Callout icon={<AlertTriangle size={13} />} color="#f59e0b" t={t}>
        버튼을 여러 번 누르지 마세요. 한 번 누른 후 화면이 나올 때까지 기다리면 됩니다.
      </Callout>
    </div>
  )
}

function Step2({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        영상이 시작되면 시스템이 자동으로 화면을 분석합니다. 아무것도 하지 않아도 됩니다.
      </p>

      <Section title="탐지 단계란?" color="#10b981" t={t}>
        <p style={{ fontSize: 12, color: t.colors.textMuted, lineHeight: 1.7, marginBottom: 8 }}>
          시스템은 한 번에 판단하지 않고 <Bold>4단계</Bold>에 걸쳐 화면을 확인합니다.
          단계가 높을수록 해당 Target 화면임이 더 확실한 상태입니다.
        </p>
        <div className="space-y-2">
          {[
            { stage: 'T1', desc: '1번 화면 감지 — 공정 첫 번째 화면 인식', color: '#fbbf24' },
            { stage: 'T2', desc: '2번 화면 감지 — 공정 두 번째 화면 인식', color: '#f97316' },
            { stage: 'T3', desc: '3번 화면 감지 — 공정 세 번째 화면 인식', color: '#ef4444' },
            { stage: 'T4', desc: '4번 화면 감지 — 공정 완료 → 로봇 동작 신호 전송', color: '#dc2626' },
          ].map(({ stage, desc, color }) => (
            <div key={stage} className="flex items-center gap-3 rounded px-3 py-2"
                 style={{ background: color + '18', border: `1px solid ${color}35` }}>
              <span className="rounded px-2 py-0.5 text-xs font-bold" style={{ background: color, color: '#fff', minWidth: 28, textAlign: 'center' }}>
                {stage}
              </span>
              <span style={{ fontSize: 12, color: t.colors.text }}>{desc}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="화면에 표시되는 숫자들" color="#6366f1" t={t}>
        <TableRow label="Gate 점수" desc="이상 여부를 0~1로 나타낸 수치. 1에 가까울수록 이상 없음." t={t} />
        <TableRow label="신뢰도 (%)" desc="시스템이 '이게 맞다'고 확신하는 정도." t={t} />
        <TableRow label="지연 (ms)" desc="분석에 걸린 시간(밀리초). 숫자가 작을수록 빠름." t={t} />
      </Section>

      <Callout icon={<CheckCircle2 size={13} />} color="#10b981" t={t}>
        화면 속 숫자들이 바뀌면서 분석 중인 것이 정상입니다. 숫자가 완전히 멈추면 스트림이 끊긴 것일 수 있습니다.
      </Callout>
    </div>
  )
}

function Step3({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        T4 단계까지 확정되면 알림이 자동으로 발송됩니다. 알림 내용 읽는 법을 익히세요.
      </p>

      <Section title="알림 구성" color="#f59e0b" t={t}>
        <TableRow label="감지 화면" desc="감지된 Target 화면 번호 (예: Target1, Target2)." t={t} />
        <TableRow label="현재 상황" desc="공정이 어느 단계인지 한 줄 설명." t={t} />
        <TableRow label="다음 조치" desc="로봇이 수행할 동작 또는 담당자가 확인할 사항." t={t} />
        <TableRow label="긴급도" desc="낮음 / 보통 / 높음 / 최고 중 하나가 표시됩니다." t={t} />
        <TableRow label="감지 횟수" desc="이번 세션에서 해당 화면이 몇 번 확정됐는지 기록." t={t} />
      </Section>

      <Section title="긴급도별 대응 기준 (참고)" color="#ef4444" t={t}>
        {[
          { level: '낮음', action: '화면 확인 후 계속 모니터링', color: '#10b981' },
          { level: '보통', action: '담당자에게 알림 확인 요청', color: '#f59e0b' },
          { level: '높음', action: '즉시 담당 엔지니어에게 보고', color: '#f97316' },
          { level: '최고', action: '공정 중단 후 설비 점검', color: '#ef4444' },
        ].map(({ level, action, color }) => (
          <div key={level} className="flex items-start gap-3 rounded px-3 py-2 mb-1.5"
               style={{ background: color + '14', border: `1px solid ${color}30` }}>
            <span className="rounded px-2 py-0.5 text-xs font-bold shrink-0" style={{ background: color, color: '#fff' }}>
              {level}
            </span>
            <span style={{ fontSize: 12, color: t.colors.text }}>{action}</span>
          </div>
        ))}
      </Section>

      <Callout icon={<Volume2 size={13} />} color="#6366f1" t={t}>
        알림은 화면 오른쪽에 팝업으로 표시됩니다. 확인하지 않으면 알림이 계속 쌓이니 정기적으로 확인하세요.
      </Callout>
    </div>
  )
}

function Step4({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        상단 탭 <Bold>실시간</Bold> → <Bold>성능 지표</Bold> 화면입니다. 시스템이 얼마나 잘 작동하는지 보여줍니다.
      </p>

      <Section title="신호등 색깔 의미" color="#8b5cf6" t={t}>
        <div className="space-y-2">
          {[
            { color: '#10b981', label: '초록 (정상)', desc: '목표치를 달성하고 있습니다.' },
            { color: '#f59e0b', label: '노랑 (주의)', desc: '목표치에 가깝지만 완전하지는 않습니다. 계속 지켜보세요.' },
            { color: '#ef4444', label: '빨강 (불량)', desc: '목표치를 크게 벗어났습니다. 담당 엔지니어에게 알리세요.' },
            { color: '#6b7280', label: '회색 (측정불가)', desc: '아직 데이터가 충분하지 않거나 측정 조건이 미충족입니다.' },
          ].map(({ color, label, desc }) => (
            <div key={label} className="flex items-start gap-3 rounded px-3 py-2"
                 style={{ background: color + '12', border: `1px solid ${color}30` }}>
              <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ background: color }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.colors.text }}>{label}</div>
                <div style={{ fontSize: 11, color: t.colors.textMuted }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="주요 지표 쉬운 설명" color="#3b82f6" t={t}>
        <TableRow label="통과율 (Pass-through)" desc="전체 프레임 중 Target 화면 후보로 올라온 비율. 10~40%가 정상 범위." t={t} />
        <TableRow label="순서 오류율" desc="T1→T4 순서가 어긋난 경우의 비율. 낮을수록 좋음." t={t} />
        <TableRow label="공정 완주율" desc="T1 인식 후 T4까지 정상 완료된 비율. 높을수록 좋음." t={t} />
        <TableRow label="알림 지연" desc="화면 확정 후 알림까지 걸리는 시간(ms). 200ms 이하가 목표." t={t} />
      </Section>

      <Callout icon={<Info size={13} />} color="#8b5cf6" t={t}>
        지표가 전부 회색(측정불가)으로 표시된다면 아직 영상 스트리밍이 시작되지 않은 것입니다. 먼저 <Bold>실시간 검출</Bold> 화면에서 카메라를 시작하세요.
      </Callout>
    </div>
  )
}

function Step5({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        상단 탭 <Bold>능동학습</Bold> → <Bold>AL 레이블링</Bold> 화면입니다. 시스템이 스스로 판단하기 어려웠던 장면에 대해 운용자가 정답을 알려주는 작업입니다.
      </p>

      <Section title="레이블링이란?" color="#ec4899" t={t}>
        <p style={{ fontSize: 12, color: t.colors.textMuted, lineHeight: 1.7 }}>
          시스템이 "이 화면이 어떤 Target인지 잘 모르겠다"고 판단한 장면들이 카드 형태로 나타납니다.
          담당자가 직접 눈으로 보고 T1~T4 중 어느 화면인지 선택하면 시스템이 학습하게 됩니다.
        </p>
      </Section>

      <Section title="레이블링 방법" color="#ec4899" t={t}>
        <Step num={1} t={t}>카드에 표시된 <Bold>실제 이미지</Bold>를 확인합니다.</Step>
        <Step num={2} t={t}>카드 아래 확률 막대와 예측 힌트를 참고합니다.</Step>
        <Step num={3} t={t}>해당 공정 화면 버튼(<Bold>T1 / T2 / T3 / T4</Bold>)을 누릅니다.</Step>
        <Step num={4} t={t}>잘못 눌렀으면 <Bold>Undo</Bold> 버튼(또는 Ctrl+Z)으로 취소합니다.</Step>
        <Step num={5} t={t}>모르겠는 이미지는 <Bold>건너뛰기(→ 아이콘)</Bold>를 눌러도 됩니다.</Step>
      </Section>

      <Section title="단축키" color="#6366f1" t={t}>
        <TableRow label="숫자 키 1~4" desc="첫 번째 카드에 T1~T4 레이블 빠르게 지정." t={t} />
        <TableRow label="S 키" desc="첫 번째 카드 건너뛰기." t={t} />
        <TableRow label="R 키" desc="큐 새로고침." t={t} />
        <TableRow label="Ctrl+Z" desc="마지막 레이블 취소." t={t} />
      </Section>

      <Callout icon={<RotateCcw size={13} />} color="#ec4899" t={t}>
        레이블링한 샘플이 일정 수 모이면 <Bold>재학습</Bold> 버튼으로 시스템을 개선할 수 있습니다. 재학습은 몇 분 소요될 수 있으니 기다려주세요.
      </Callout>
    </div>
  )
}

function Step6({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <div className="space-y-5">
      <p style={{ fontSize: 13, color: t.colors.text, lineHeight: 1.7 }}>
        문제가 생겼을 때 대처 방법입니다. 아래에서 해당 상황을 찾아보세요.
      </p>

      <Section title="자주 겪는 문제" color="#ef4444" t={t}>
        <Faq
          q="화면이 검은색이거나 영상이 안 나와요"
          t={t}
        >
          카메라 시작 버튼을 눌렀는지 확인하세요. 눌렀는데도 안 나오면 장치 번호가 맞는지 확인하고, 다시 시작 버튼을 눌러보세요.
        </Faq>

        <Faq q="알림이 너무 자주 와서 시끄러워요" t={t}>
          알림 디바운싱이 켜져 있어 연속 감지 시 한 번만 발송됩니다. 알림이 계속 많다면 공정 화면이 자주 감지되고 있는 것이니 담당 엔지니어에게 임계값 조정을 요청하세요.
        </Faq>

        <Faq q="성능 지표가 전부 회색(N/A)으로 표시돼요" t={t}>
          영상 스트리밍이 시작되지 않은 것입니다. 실시간 검출 화면으로 가서 카메라를 먼저 시작하세요.
        </Faq>

        <Faq q="네트워크가 끊겼어요 / 화면이 멈췄어요" t={t}>
          현재 버전은 네트워크 단절 시 화면이 정지됩니다. 인터넷 연결을 복원한 후 페이지를 새로고침(F5)하고 카메라를 다시 시작하세요.
        </Faq>

        <Faq q="레이블링 중 잘못 눌렀어요" t={t}>
          Undo 버튼(또는 Ctrl+Z)을 누르면 마지막 레이블이 취소됩니다. 레이블 이력 패널에서 특정 항목만 골라 취소할 수도 있습니다.
        </Faq>

        <Faq q="재학습 버튼이 비활성화되어 있어요" t={t}>
          레이블링된 샘플이 없을 때는 재학습 버튼이 비활성화됩니다. AL 레이블링 화면에서 샘플에 레이블을 붙인 후 시도하세요.
        </Faq>
      </Section>

      <Section title="기술 지원 요청 전 확인 사항" color="#6366f1" t={t}>
        <div className="space-y-1.5">
          {[
            '백엔드 서버가 실행 중인지 확인',
            '카메라/영상 파일 연결 상태 확인',
            '브라우저 콘솔(F12)에 오류 메시지 캡처',
            '언제부터 문제가 생겼는지 시간 기록',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs" style={{ color: t.colors.textMuted }}>
              <CheckCircle2 size={12} style={{ color: '#10b981', flexShrink: 0 }} />
              {item}
            </div>
          ))}
        </div>
      </Section>

      <Callout icon={<WifiOff size={13} />} color="#6b7280" t={t}>
        현재 시스템은 인터넷 연결이 필요합니다. 야외·전방 환경에서는 네트워크 안정성을 사전에 확인하세요.
      </Callout>
    </div>
  )
}

// ── 재사용 UI 컴포넌트 ────────────────────────────────────────────────────

function Section({ title, color, children, t }: {
  title: string; color: string; children: React.ReactNode; t: ReturnType<typeof useTheme>
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${t.colors.border}` }}>
      <div className="px-3 py-2" style={{ background: color + '18', borderBottom: `1px solid ${color}30` }}>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
      </div>
      <div className="p-3 space-y-2" style={{ background: t.colors.bgPanel }}>
        {children}
      </div>
    </div>
  )
}

function Step({ num, children, t }: { num: number; children: React.ReactNode; t: ReturnType<typeof useTheme> }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
           style={{ background: t.colors.accent + '25', fontSize: 10, fontWeight: 700, color: t.colors.accent }}>
        {num}
      </div>
      <p style={{ fontSize: 12, color: t.colors.text, lineHeight: 1.7 }}>{children}</p>
    </div>
  )
}

function TableRow({ label, desc, t }: { label: string; desc: string; t: ReturnType<typeof useTheme> }) {
  return (
    <div className="flex items-start gap-3 py-1" style={{ borderBottom: `1px solid ${t.colors.border}` }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: t.colors.accent, minWidth: 120, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: t.colors.textMuted, lineHeight: 1.6 }}>{desc}</span>
    </div>
  )
}

function Callout({ icon, color, children, t }: {
  icon: React.ReactNode; color: string; children: React.ReactNode; t: ReturnType<typeof useTheme>
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2.5"
         style={{ background: color + '12', border: `1px solid ${color}30` }}>
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <p style={{ fontSize: 12, color: t.colors.text, lineHeight: 1.7 }}>{children}</p>
    </div>
  )
}

function Faq({ q, children, t }: { q: string; children: React.ReactNode; t: ReturnType<typeof useTheme> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded" style={{ border: `1px solid ${t.colors.border}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ background: t.colors.bgInput }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: t.colors.text }}>{q}</span>
        <ChevronRight size={12} style={{ color: t.colors.textDim, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="px-3 py-2" style={{ background: t.colors.bgPanel }}>
          <p style={{ fontSize: 12, color: t.colors.textMuted, lineHeight: 1.7 }}>{children}</p>
        </div>
      )}
    </div>
  )
}

function Bold({ children }: { children: React.ReactNode }) {
  return <strong style={{ fontWeight: 700 }}>{children}</strong>
}

// ── 메인 모달 ─────────────────────────────────────────────────────────────

const STEP_CONTENT: Record<number, (props: { t: ReturnType<typeof useTheme> }) => JSX.Element> = {
  1: Step1,
  2: Step2,
  3: Step3,
  4: Step4,
  5: Step5,
  6: Step6,
}

interface ManualModalProps {
  onClose: () => void
}

export default function ManualModal({ onClose }: ManualModalProps) {
  const t = useTheme()
  const [activeStep, setActiveStep] = useState(1)

  const StepContent = STEP_CONTENT[activeStep]
  const currentStep = STEPS.find(s => s.id === activeStep)!

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-4 z-50 rounded-xl overflow-hidden flex shadow-2xl"
           style={{ border: `1px solid ${t.colors.border}`, background: t.colors.bg }}>

        {/* 왼쪽: 단계 목록 */}
        <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: 220, background: t.colors.bgSidebar, borderRight: `1px solid ${t.colors.border}` }}>
          {/* 헤더 */}
          <div className="px-4 py-4" style={{ borderBottom: `1px solid ${t.colors.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.colors.textHeading, marginBottom: 2 }}>
              운용 설명서
            </div>
            <div style={{ fontSize: 10, color: t.colors.textDim }}>
              단계를 클릭해서 읽으세요
            </div>
          </div>

          {/* 단계 목록 */}
          <div className="flex-1 overflow-y-auto py-2">
            {STEPS.map(step => {
              const Icon = step.icon
              const isActive = activeStep === step.id
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 mx-1 rounded-lg text-left transition-colors"
                  style={{
                    width: 'calc(100% - 8px)',
                    background: isActive ? step.color + '20' : 'transparent',
                    border: isActive ? `1px solid ${step.color}40` : '1px solid transparent',
                  }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                       style={{ background: isActive ? step.color : t.colors.bgInput }}>
                    <Icon size={13} style={{ color: isActive ? '#fff' : t.colors.textDim }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? t.colors.textHeading : t.colors.textMuted }}>
                      {step.id}단계. {step.title}
                    </div>
                    <div style={{ fontSize: 10, color: t.colors.textDim, marginTop: 1 }}>
                      {step.subtitle}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 진행 상황 */}
          <div className="px-4 py-3" style={{ borderTop: `1px solid ${t.colors.border}` }}>
            <div className="flex gap-1 mb-1">
              {STEPS.map(s => (
                <div key={s.id} className="flex-1 h-1 rounded-full"
                     style={{ background: s.id <= activeStep ? s.color : t.colors.border }} />
              ))}
            </div>
            <div style={{ fontSize: 10, color: t.colors.textDim }}>
              {activeStep} / {STEPS.length} 단계
            </div>
          </div>
        </div>

        {/* 오른쪽: 내용 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 내용 헤더 */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4"
               style={{ borderBottom: `1px solid ${t.colors.border}`, background: t.colors.bgPanel }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                   style={{ background: currentStep.color + '20' }}>
                {(() => { const Icon = currentStep.icon; return <Icon size={16} style={{ color: currentStep.color }} /> })()}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.colors.textHeading }}>
                  {currentStep.id}단계 — {currentStep.title}
                </div>
                <div style={{ fontSize: 11, color: t.colors.textMuted }}>{currentStep.subtitle}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ color: t.colors.textDim, padding: 4 }}
                    className="rounded hover:opacity-70 transition-opacity">
              <X size={18} />
            </button>
          </div>

          {/* 내용 본문 */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <StepContent t={t} />
          </div>

          {/* 하단 네비게이션 */}
          <div className="shrink-0 flex items-center justify-between px-6 py-3"
               style={{ borderTop: `1px solid ${t.colors.border}`, background: t.colors.bgPanel }}>
            <button
              onClick={() => setActiveStep(v => Math.max(1, v - 1))}
              disabled={activeStep === 1}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-opacity disabled:opacity-30"
              style={{ background: t.colors.bgInput, color: t.colors.text, border: `1px solid ${t.colors.border}` }}>
              ← 이전
            </button>

            <span style={{ fontSize: 11, color: t.colors.textDim }}>
              클릭하거나 페이지를 넘겨서 읽으세요
            </span>

            {activeStep < STEPS.length ? (
              <button
                onClick={() => setActiveStep(v => Math.min(STEPS.length, v + 1))}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs"
                style={{ background: currentStep.color, color: '#fff' }}>
                다음 →
              </button>
            ) : (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs"
                style={{ background: '#10b981', color: '#fff' }}>
                <CheckCircle2 size={11} /> 읽기 완료
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
