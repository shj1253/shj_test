import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Camera, FlaskConical, BarChart3, Tags, Activity, Settings2,
  ChevronDown, Sun, Moon, Monitor,
} from 'lucide-react'
import { useThemeStore, THEME_LABELS, type ThemeId } from '../../store/themeStore'

/* ─── Navigation structure: 3 workflow groups ─── */

const WORKFLOW_GROUPS = [
  {
    id: 'prepare',
    label: '사전학습',
    items: [
      { to: '/training', label: '학습 설정', icon: Settings2 },
      { to: '/test', label: '테스트 추론', icon: FlaskConical },
      { to: '/compare', label: '모델 비교', icon: Activity },
    ],
  },
  {
    id: 'realtime',
    label: '실시간',
    items: [
      { to: '/', label: '실시간 검출', icon: Camera },
      { to: '/metrics', label: '성능 지표', icon: BarChart3 },
    ],
  },
  {
    id: 'al',
    label: '능동학습',
    items: [
      { to: '/labels', label: 'AL 레이블링', icon: Tags },
    ],
  },
]

const THEME_ICONS: Record<ThemeId, typeof Sun> = {
  light: Sun,
  dark: Moon,
  navy: Monitor,
}

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { themeId, colors, setTheme } = useThemeStore()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showThemePicker, setShowThemePicker] = useState(false)

  const activeGroup = WORKFLOW_GROUPS.find(g =>
    g.items.some(item =>
      item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
    )
  )

  const toggleGroup = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const ThemeIcon = THEME_ICONS[themeId]

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: colors.bg, color: colors.text }}>
      {/* ─── Top: Activity bar (horizontal, VSCode-style tabs) ─── */}
      <div className="flex items-stretch shrink-0" style={{ height: 35, background: colors.bgActivityBar, borderBottom: `1px solid ${colors.border}` }}>
        {/* Logo */}
        <div className="flex items-center px-3 gap-2 shrink-0" style={{ borderRight: `1px solid ${colors.border}` }}>
          <span className="text-xs font-semibold" style={{ color: colors.textHeading }}>CANNON</span>
        </div>

        {/* Workflow group tabs */}
        <div className="flex items-stretch flex-1">
          {WORKFLOW_GROUPS.map(group => {
            const isActive = activeGroup?.id === group.id
            return (
              <button
                key={group.id}
                onClick={() => toggleGroup(group.id)}
                className="flex items-center gap-1.5 px-4 text-xs font-medium transition-colors relative"
                style={{
                  color: isActive ? colors.textHeading : colors.textMuted,
                  background: isActive ? colors.bg : 'transparent',
                  borderRight: `1px solid ${colors.border}`,
                }}
              >
                {group.label}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: colors.accent }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Theme picker */}
        <div className="flex items-center px-2 relative">
          <button
            onClick={() => setShowThemePicker(!showThemePicker)}
            className="p-1.5 rounded transition-colors"
            style={{ color: colors.textMuted }}
            title="테마 변경"
          >
            <ThemeIcon size={14} />
          </button>
          {showThemePicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowThemePicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 rounded shadow-xl overflow-hidden"
                   style={{ background: colors.bgPanel, border: `1px solid ${colors.border}`, minWidth: 120 }}>
                {(Object.keys(THEME_LABELS) as ThemeId[]).map(id => {
                  const TIcon = THEME_ICONS[id]
                  return (
                    <button
                      key={id}
                      onClick={() => { setTheme(id); setShowThemePicker(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors"
                      style={{
                        color: themeId === id ? colors.accent : colors.text,
                        background: themeId === id ? colors.accentMuted : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (themeId !== id) e.currentTarget.style.background = colors.bgHover
                      }}
                      onMouseLeave={(e) => {
                        if (themeId !== id) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <TIcon size={12} />
                      {THEME_LABELS[id]}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Main area: sidebar + content ─── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="shrink-0 overflow-y-auto" style={{
          width: 180,
          background: colors.bgSidebar,
          borderRight: `1px solid ${colors.border}`,
        }}>
          <div className="py-2">
            {WORKFLOW_GROUPS.map(group => {
              const isCollapsed = collapsed[group.id]
              return (
                <div key={group.id}>
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: colors.textMuted }}
                  >
                    <ChevronDown
                      size={10}
                      style={{
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 150ms',
                      }}
                    />
                    {group.label}
                  </button>
                  {!isCollapsed && (
                    <div className="mb-1">
                      {group.items.map(item => {
                        const Icon = item.icon
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.to === '/'}
                            className="block"
                          >
                            {({ isActive }) => (
                              <div
                                className="flex items-center gap-2 px-4 py-1 mx-1 rounded text-[11px] transition-colors cursor-pointer"
                                style={{
                                  color: isActive ? colors.textHeading : colors.textMuted,
                                  background: isActive ? colors.bgActive : 'transparent',
                                  fontWeight: isActive ? 500 : 400,
                                }}
                                onMouseEnter={(e) => {
                                  if (!isActive) e.currentTarget.style.background = colors.bgHover
                                }}
                                onMouseLeave={(e) => {
                                  if (!isActive) e.currentTarget.style.background = 'transparent'
                                }}
                              >
                                <Icon size={13} />
                                {item.label}
                              </div>
                            )}
                          </NavLink>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>

      {/* ─── Status bar ─── */}
      <div className="shrink-0 flex items-center justify-between px-3"
           style={{ height: 22, background: colors.bgStatusBar, fontSize: 11 }}>
        <div className="flex items-center gap-3 text-white/80">
          <span>CANNON v0.1.0</span>
        </div>
        <div className="flex items-center gap-3 text-white/80">
          <span>{THEME_LABELS[themeId]} Theme</span>
        </div>
      </div>
    </div>
  )
}
