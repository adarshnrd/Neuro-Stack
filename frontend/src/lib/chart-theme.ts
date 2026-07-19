import type { Theme } from '@/store/ui.store'

/** Blue — AI-estimated work hours (Daily Effort chart). */
export const CHART_EFFORT_ESTIMATED = '#3b82f6'

/** Emerald — developer-reported work hours (Daily Effort chart). */
export const CHART_EFFORT_REPORTED = '#10b981'

const DARK_THEMES = new Set<Theme>([
  'theme-dark',
  'theme-dim',
  'theme-nord',
  'theme-dracula',
  'theme-high-contrast',
])

export function isDarkChartTheme(theme: Theme): boolean {
  return DARK_THEMES.has(theme)
}

export interface ChartThemeTokens {
  text: string
  muted: string
  grid: string
  dataLabel: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}

export function chartThemeTokens(isDark: boolean): ChartThemeTokens {
  return {
    text: isDark ? '#e2e8f0' : '#1e293b',
    muted: isDark ? '#94a3b8' : '#64748b',
    grid: isDark ? '#374151' : '#e2e8f0',
    dataLabel: isDark ? '#f8fafc' : '#0f172a',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipBorder: isDark ? '#475569' : '#e2e8f0',
    tooltipText: isDark ? '#f1f5f9' : '#0f172a',
  }
}

/** Wrap custom Apex HTML tooltip content with theme-aware surface colors. */
export function chartTooltipShell(isDark: boolean, innerHtml: string): string {
  const t = chartThemeTokens(isDark)
  return `<div style="padding:8px 12px;font-size:12px;line-height:1.6;background:${t.tooltipBg};color:${t.tooltipText};border:1px solid ${t.tooltipBorder};border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,${isDark ? '0.35' : '0.08'})">${innerHtml}</div>`
}
