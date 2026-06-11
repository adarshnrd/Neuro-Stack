'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { ApexOptions } from 'apexcharts'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui.store'
import type { DayEntry } from '@/hooks/useOrgAnalytics'
import type { DailySummary } from '@/types/analytics.types'
import {
  DeveloperSeriesPicker,
  type DeveloperOption,
} from '@/components/charts/DeveloperSeriesPicker'

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

const DARK_THEMES = new Set([
  'theme-dark',
  'theme-dim',
  'theme-nord',
  'theme-dracula',
  'theme-high-contrast',
])

const CHART_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#a855f7',
  '#eab308',
]

const TOP_DEFAULT = 12
const READABILITY_WARN = 15

type View = 'commits' | 'lines' | 'efficiency'

const VIEW_LABELS: Record<View, string> = {
  commits: 'Commits',
  lines: 'Lines Changed',
  efficiency: 'Efficiency %',
}

function metricValue(s: DailySummary | undefined, view: View): number {
  if (!s) return 0
  if (view === 'commits') return s.totalCommits
  if (view === 'lines') return s.totalLinesAdded + s.totalLinesRemoved
  return s.avgEfficiencyScore ?? 0
}

function formatMetric(val: number, view: View): string {
  if (view === 'efficiency') return `${val.toFixed(0)}%`
  return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val)
}

interface MonthlyBarChartProps {
  dayData: DayEntry[]
  isLoading?: boolean
}

function MonthlyBarChart({ dayData, isLoading }: MonthlyBarChartProps) {
  const [view, setView] = useState<View>('commits')
  const [selectedDevIds, setSelectedDevIds] = useState<string[]>([])
  const theme = useUIStore((s) => s.theme)
  const isDark = DARK_THEMES.has(theme)

  const monthKey = dayData[0]?.date.slice(0, 7) ?? ''

  const { developers, nameMap } = useMemo(() => {
    const commitTotals = new Map<string, number>()
    const names = new Map<string, string>()

    for (const { summaries } of dayData) {
      for (const s of summaries) {
        commitTotals.set(
          s.developerAzureId,
          (commitTotals.get(s.developerAzureId) ?? 0) + s.totalCommits,
        )
        if (s.displayName) names.set(s.developerAzureId, s.displayName)
      }
    }

    const list: DeveloperOption[] = [...commitTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, monthlyCommits]) => ({
        id,
        name: names.get(id) ?? id,
        monthlyCommits,
      }))

    return { developers: list, nameMap: names }
  }, [dayData])

  useEffect(() => {
    setSelectedDevIds(developers.slice(0, TOP_DEFAULT).map((d) => d.id))
  }, [monthKey]) // reset selection when month changes only

  const xCategories = useMemo(
    () =>
      dayData.map((d) => {
        try {
          return format(parseISO(d.date), 'MMM d')
        } catch {
          return d.date
        }
      }),
    [dayData],
  )

  const devIdSet = useMemo(() => new Set(developers.map((d) => d.id)), [developers])
  const activeDevIds = selectedDevIds.filter((id) => devIdSet.has(id))

  const series = activeDevIds.map((devId, colorIdx) => ({
    name: nameMap.get(devId) ?? devId,
    data: dayData.map(({ summaries }) => {
      const s = summaries.find((x) => x.developerAzureId === devId)
      return metricValue(s, view)
    }),
    color: CHART_PALETTE[colorIdx % CHART_PALETTE.length],
  }))

  const options: ApexOptions = {
    chart: {
      type: 'line',
      background: 'transparent',
      toolbar: { show: false },
      fontFamily: 'inherit',
      zoom: { enabled: false },
    },
    stroke: {
      curve: 'smooth',
      width: 2,
    },
    markers: {
      size: 3,
      hover: { size: 5 },
    },
    xaxis: {
      categories: xCategories,
      title: {
        text: 'Day',
        style: { fontSize: '11px' },
        offsetY: 2,
      },
      labels: {
        rotate: xCategories.length > 15 ? -35 : 0,
        style: { fontSize: '10px' },
      },
    },
    yaxis: {
      title: {
        text: VIEW_LABELS[view],
        style: { fontSize: '11px' },
      },
      labels: {
        style: { fontSize: '10px' },
        formatter: (val) => formatMetric(val, view),
      },
      ...(view === 'efficiency' ? { min: 0, max: 100 } : {}),
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '10px',
      itemMargin: { horizontal: 6 },
      markers: { size: 5 },
    },
    tooltip: {
      shared: true,
      intersect: false,
      custom: ({ dataPointIndex }) => {
        const dateLabel = xCategories[dataPointIndex] ?? ''
        const day = dayData[dataPointIndex]
        if (!day) return ''

        const rows = activeDevIds
          .map((devId, i) => {
            const s = day.summaries.find((x) => x.developerAzureId === devId)
            const val = metricValue(s, view)
            if (val === 0 && view !== 'efficiency') return null
            const name = nameMap.get(devId) ?? devId
            const color = CHART_PALETTE[i % CHART_PALETTE.length]
            return `<div style="display:flex;align-items:center;gap:6px">
              <span style="color:${color}">&#9679;</span>
              <span>${name}: <strong>${formatMetric(val, view)}</strong></span>
            </div>`
          })
          .filter(Boolean)
          .join('')

        return `<div style="padding:8px 12px;font-size:12px;line-height:1.7">
          <strong>${dateLabel}</strong>
          ${rows || '<div style="margin-top:4px;color:#9ca3af">No activity</div>'}
        </div>`
      },
    },
    grid: { borderColor: isDark ? '#374151' : '#e5e7eb' },
    dataLabels: { enabled: false },
    theme: { mode: isDark ? 'dark' : 'light' },
  }

  if (isLoading || dayData.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        {isLoading ? 'Loading monthly data…' : 'No data for selected month'}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {(['commits', 'lines', 'efficiency'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <DeveloperSeriesPicker
          developers={developers}
          selectedIds={selectedDevIds}
          onChange={setSelectedDevIds}
          topCount={TOP_DEFAULT}
        />
      </div>
      {activeDevIds.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
          Select at least one developer to show trends
        </div>
      ) : (
        <Chart type="line" series={series} options={options} height={360} />
      )}
      {activeDevIds.length > READABILITY_WARN && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Tip: click legend items to hide lines, or reduce the selection for a clearer chart.
        </p>
      )}
    </div>
  )
}

export { MonthlyBarChart }
export default MonthlyBarChart
