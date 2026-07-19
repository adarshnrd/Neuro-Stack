'use client'

import React, { useState, useCallback, cloneElement } from 'react'
import type { ReactElement } from 'react'
import CalendarHeatmap from 'react-calendar-heatmap'
import { useUIStore } from '@/store/ui.store'
import type { DayEntry } from '@/hooks/useOrgAnalytics'

const DARK_THEMES = new Set([
  'theme-dark',
  'theme-dim',
  'theme-nord',
  'theme-dracula',
  'theme-high-contrast',
])

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface TooltipState {
  x: number
  y: number
  date: string
  count: number
}

interface CommitHeatmapProps {
  month: string // YYYY-MM
  dayData?: DayEntry[]
  commitValues?: { date: string; count: number }[]
  isLoading?: boolean
}

function CommitHeatmap({ month, dayData, commitValues, isLoading }: CommitHeatmapProps) {
  const theme = useUIStore((s) => s.theme)
  const isDark = DARK_THEMES.has(theme)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as SVGElement
    if (target.tagName !== 'rect') {
      setTooltip(null)
      return
    }
    const dateAttr = target.getAttribute('data-date')
    const countAttr = target.getAttribute('data-count')
    if (!dateAttr || countAttr === null) {
      setTooltip(null)
      return
    }
    const count = parseInt(countAttr, 10)
    if (!count) {
      setTooltip(null)
      return
    }
    setTooltip({ x: e.clientX, y: e.clientY, date: dateAttr, count })
  }, [])

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  if (isLoading) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
        Loading calendar…
      </div>
    )
  }

  const [yearStr, mmStr] = month.split('-')
  const year = parseInt(yearStr)
  const mm = parseInt(mmStr)
  const startDate = new Date(year, mm - 1, 1)
  const endDate = new Date(year, mm, 0)

  const values = commitValues ?? (dayData ?? []).map(({ date, summaries }) => ({
    date,
    count: summaries.reduce((sum, s) => sum + s.totalCommits, 0),
  }))

  const emptyColor = isDark ? '#2d333b' : '#ebedf0'
  const textColor = isDark ? '#9ca3af' : '#6b7280'

  // Format tooltip content
  const formatTooltip = (t: TooltipState) => {
    const [y, mo, d] = t.date.split('-').map(Number)
    const dayName = DAYS[new Date(y, mo - 1, d).getDay()]
    const dateLabel = new Date(y, mo - 1, d).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    return { dayName, dateLabel, count: t.count }
  }

  return (
    <div
      className="w-full overflow-x-auto"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <style>{`
        .chm-wrap svg          { display: block; height: 110px; width: auto; max-width: 100%; }
        .chm-wrap text         { fill: ${textColor}; font-size: 10px; }
        .chm-wrap .chm-empty   { fill: ${emptyColor}; }
        .chm-wrap .chm-low     { fill: #9be9a8; }
        .chm-wrap .chm-mid     { fill: #40c463; }
        .chm-wrap .chm-high    { fill: #216e39; }
        .chm-wrap .react-calendar-heatmap-month-label { font-size: 10px; }
        .chm-wrap rect         { cursor: default; }
      `}</style>
      <div className="chm-wrap">
        <CalendarHeatmap
          startDate={startDate}
          endDate={endDate}
          values={values}
          classForValue={(value) => {
            if (!value || !value.count) return 'chm-empty'
            if (value.count <= 3) return 'chm-low'
            if (value.count <= 8) return 'chm-mid'
            return 'chm-high'
          }}
          transformDayElement={(el, value) =>
            cloneElement(el as ReactElement, {
              'data-date': String((value as { date?: string } | null)?.date ?? ''),
              'data-count': String((value as { count?: number } | null)?.count ?? 0),
            })
          }
          showWeekdayLabels={false}
          showOutOfRangeDays={false}
        />
      </div>

      {tooltip && (() => {
        const { dayName, dateLabel, count } = formatTooltip(tooltip)
        const OFFSET = 14
        return (
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-3 py-2 shadow-md"
            style={{ left: tooltip.x + OFFSET, top: tooltip.y + OFFSET }}
          >
            <p className="text-[11px] font-semibold text-foreground">{dayName}</p>
            <p className="text-[11px] text-muted-foreground">{dateLabel}</p>
            <p className="mt-1 text-[12px] font-bold text-foreground">
              {count} commit{count !== 1 ? 's' : ''} pushed
            </p>
          </div>
        )
      })()}
    </div>
  )
}

export { CommitHeatmap }
export default CommitHeatmap
