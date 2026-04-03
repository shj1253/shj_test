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
  { to: '/test', label: '테스트 모드', icon: FlaskConical },
  { to: '/metrics', label: '성능 지표', icon: BarChart3 },
  { to: '/labels', label: 'AL 레이블링', icon: Tags },
  { to: '/compare', label: '모델 비교', icon: Activity },
  { to: '/training', label: '학습 설정', icon: Settings2 },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
        {/* 헤더 */}
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-sm">C</div>
            <span className="font-semibold text-lg">Canon Project</span>
          </div>
          <nav className="flex gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`
                }
              >
                <Icon size={14} />
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
