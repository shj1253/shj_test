import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Activity, Camera, FlaskConical, Tags, BarChart3, Settings2 } from 'lucide-react'
import LivePage from './pages/LivePage'
import TestPage from './pages/TestPage'
import MetricsPage from './pages/MetricsPage'
import LabelReviewPage from './pages/LabelReviewPage'
import ModelComparePage from './pages/ModelComparePage'
import TrainingPage from './pages/TrainingPage'

const NAV_ITEMS = [
  { to: '/', label: '실시간 검출', icon: Camera },
  { to: '/test', label: '테스트', icon: FlaskConical },
  { to: '/metrics', label: '성능 지표', icon: BarChart3 },
  { to: '/labels', label: '레이블링', icon: Tags },
  { to: '/compare', label: '모델 비교', icon: Activity },
  { to: '/training', label: '학습 설정', icon: Settings2 },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0a0e17] text-slate-200 flex flex-col">
        {/* 헤더 */}
        <header className="h-11 bg-[#0f1520] border-b border-[#1a2332] px-5 flex items-center gap-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
              <span className="text-[10px] font-bold text-white leading-none">C</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-slate-100 tracking-tight">CANNON</span>
              <span className="text-[10px] text-slate-500 font-medium">v0.1</span>
            </div>
          </div>

          <div className="h-4 w-px bg-[#1e293b]" />

          <nav className="flex gap-0.5">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-400'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-[#1a2332]'
                  }`
                }
              >
                <Icon size={13} strokeWidth={1.8} />
                {label}
              </NavLink>
            ))}
          </nav>
        </header>

        {/* 메인 */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<LivePage />} />
            <Route path="/test" element={<TestPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/labels" element={<LabelReviewPage />} />
            <Route path="/compare" element={<ModelComparePage />} />
            <Route path="/training" element={<TrainingPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
