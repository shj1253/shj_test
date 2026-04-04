import { useMemo, type CSSProperties } from 'react'
import { useThemeStore } from '../store/themeStore'

/**
 * Common themed style generators.
 * Use these instead of hardcoded colors to support Light/Dark/Navy themes.
 */
export function useTheme() {
  const { colors, themeId } = useThemeStore()

  return useMemo(() => ({
    colors,
    themeId,

    // Panel card
    panel: {
      background: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: 4,
    } as CSSProperties,

    // Section header text style
    sectionHeader: {
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
      color: colors.textMuted,
    } as CSSProperties,

    // Input style
    input: {
      background: colors.bgInput,
      border: `1px solid ${colors.border}`,
      borderRadius: 3,
      color: colors.text,
      fontSize: 12,
      padding: '4px 8px',
      outline: 'none',
    } as CSSProperties,

    // Primary button
    btnPrimary: {
      background: colors.accent,
      color: '#ffffff',
      border: 'none',
      borderRadius: 3,
      fontSize: 11,
      fontWeight: 500,
      padding: '5px 12px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    } as CSSProperties,

    // Secondary button
    btnSecondary: {
      background: colors.bgInput,
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: 3,
      fontSize: 11,
      fontWeight: 500,
      padding: '5px 12px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    } as CSSProperties,

    // Danger button
    btnDanger: {
      background: colors.danger,
      color: '#ffffff',
      border: 'none',
      borderRadius: 3,
      fontSize: 11,
      fontWeight: 500,
      padding: '5px 12px',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    } as CSSProperties,

    // Badge styles
    badge: (variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral') => {
      const map = {
        success: { bg: colors.success + '18', color: colors.success, border: colors.success + '30' },
        danger: { bg: colors.danger + '18', color: colors.danger, border: colors.danger + '30' },
        warning: { bg: colors.warning + '18', color: colors.warning, border: colors.warning + '30' },
        info: { bg: colors.info + '18', color: colors.info, border: colors.info + '30' },
        neutral: { bg: colors.textDim + '18', color: colors.textMuted, border: colors.textDim + '30' },
      }
      const c = map[variant]
      return {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.03em',
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      } as CSSProperties
    },

    // Divider
    divider: {
      borderTop: `1px solid ${colors.border}`,
    } as CSSProperties,
  }), [colors, themeId])
}
