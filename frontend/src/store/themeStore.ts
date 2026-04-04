import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeId = 'dark' | 'light' | 'navy'

export interface ThemeColors {
  // Layout
  bg: string
  bgPanel: string
  bgSidebar: string
  bgActivityBar: string
  bgStatusBar: string
  bgInput: string
  bgHover: string
  bgActive: string
  bgDropzone: string

  // Borders
  border: string
  borderLight: string

  // Text
  text: string
  textMuted: string
  textDim: string
  textHeading: string

  // Accent
  accent: string
  accentHover: string
  accentMuted: string

  // Semantic
  success: string
  danger: string
  warning: string
  info: string
}

const THEMES: Record<ThemeId, ThemeColors> = {
  dark: {
    bg: '#1e1e1e',
    bgPanel: '#252526',
    bgSidebar: '#252526',
    bgActivityBar: '#333333',
    bgStatusBar: '#007acc',
    bgInput: '#3c3c3c',
    bgHover: '#2a2d2e',
    bgActive: '#37373d',
    bgDropzone: '#2a2d2e',
    border: '#3c3c3c',
    borderLight: '#4a4a4a',
    text: '#cccccc',
    textMuted: '#969696',
    textDim: '#6a6a6a',
    textHeading: '#e0e0e0',
    accent: '#007acc',
    accentHover: '#1a8ad4',
    accentMuted: '#007acc33',
    success: '#4ec9b0',
    danger: '#f14c4c',
    warning: '#cca700',
    info: '#3794ff',
  },
  light: {
    bg: '#ffffff',
    bgPanel: '#f3f3f3',
    bgSidebar: '#f3f3f3',
    bgActivityBar: '#2c2c2c',
    bgStatusBar: '#007acc',
    bgInput: '#ffffff',
    bgHover: '#e8e8e8',
    bgActive: '#d6d6d6',
    bgDropzone: '#f8f8f8',
    border: '#e0e0e0',
    borderLight: '#e8e8e8',
    text: '#333333',
    textMuted: '#717171',
    textDim: '#a0a0a0',
    textHeading: '#1e1e1e',
    accent: '#007acc',
    accentHover: '#1a8ad4',
    accentMuted: '#007acc1a',
    success: '#16825d',
    danger: '#cd3131',
    warning: '#bf8803',
    info: '#0066bf',
  },
  navy: {
    bg: '#0a0e17',
    bgPanel: '#111827',
    bgSidebar: '#0f1520',
    bgActivityBar: '#0b1121',
    bgStatusBar: '#1d4ed8',
    bgInput: '#0f172a',
    bgHover: '#1a2332',
    bgActive: '#1e293b',
    bgDropzone: '#0f172a',
    border: '#1e293b',
    borderLight: '#334155',
    text: '#cbd5e1',
    textMuted: '#64748b',
    textDim: '#475569',
    textHeading: '#e2e8f0',
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    accentMuted: '#3b82f61a',
    success: '#34d399',
    danger: '#f87171',
    warning: '#fbbf24',
    info: '#60a5fa',
  },
}

const THEME_LABELS: Record<ThemeId, string> = {
  dark: 'Dark',
  light: 'Light',
  navy: 'Navy',
}

interface ThemeStore {
  themeId: ThemeId
  colors: ThemeColors
  setTheme: (id: ThemeId) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      themeId: 'dark',
      colors: THEMES.dark,
      setTheme: (id) => set({ themeId: id, colors: THEMES[id] }),
    }),
    { name: 'cannon-theme' }
  )
)

export { THEMES, THEME_LABELS }
