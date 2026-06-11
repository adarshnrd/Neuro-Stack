'use client'

import dynamic from 'next/dynamic'
import type { ApexOptions } from 'apexcharts'
import { format, parseISO } from 'date-fns'
import { useUIStore } from '@/store/ui.store'
import type { DailySummary } from '@/types/analytics.types'

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

const DARK_THEMES = new Set([
  'theme-dark',
  'theme-dim',
  'theme-nord',
  'theme-dracula',
  'theme-high-contrast',
])

interface LinesOfCodeChartProps {
  summaries: DailySummary[]
}

function LinesOfCodeChart({ summaries }: LinesOfCodeChartProps) {
  const theme = useUIStore((s) => s.theme)
  const isDark = DARK_THEMES.has(theme)

  if (!Array.isArray(summaries) || summaries.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No data for selected period
      </div>
    )
  }

  const sorted = [...summaries].sort((a, b) => a.date.localeCompare(b.date))

  const dates = sorted.map((s) => {
    try {
      return format(parseISO(s.date), 'MMM d')
    } catch {
      return s.date
    }
  })

  const series = [
    { name: 'Lines Added', data: sorted.map((s) => s.totalLinesAdded) },
    { name: 'Lines Removed', data: sorted.map((s) => s.totalLinesRemoved) },
  ]

  const options: ApexOptions = {
    chart: {
      type: 'area',
      background: 'transparent',
      toolbar: { show: false },
      fontFamily: 'inherit',
    },
    stroke: {
      curve: 'smooth',
      width: 2,
    },
    fill: {
      type: 'solid',
      opacity: 0.15,
    },
    colors: ['#22c55e', '#ef4444'],
    xaxis: {
      categories: dates,
      labels: {
        rotate: dates.length > 15 ? -30 : 0,
        style: { fontSize: '10px' },
      },
    },
    yaxis: {
      labels: {
        style: { fontSize: '10px' },
        formatter: (val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(val)),
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '11px',
    },
    tooltip: {
      custom: ({ dataPointIndex }) => {
        const s = sorted[dataPointIndex]
        const date = dates[dataPointIndex] ?? ''
        if (!s) return ''
        return `<div style="padding:8px 12px;font-size:12px;line-height:1.6">
          <strong>${date}</strong><br/>
          <span style="color:#22c55e">&#9679; Lines Added: <strong>${s.totalLinesAdded.toLocaleString()}</strong></span><br/>
          <span style="color:#ef4444">&#9679; Lines Removed: <strong>${s.totalLinesRemoved.toLocaleString()}</strong></span>
        </div>`
      },
    },
    markers: { size: 4 },
    grid: { borderColor: isDark ? '#374151' : '#e5e7eb' },
    dataLabels: { enabled: false },
    theme: { mode: isDark ? 'dark' : 'light' },
  }

  return <Chart type="area" series={series} options={options} height={220} />
}

export { LinesOfCodeChart }
export default LinesOfCodeChart
