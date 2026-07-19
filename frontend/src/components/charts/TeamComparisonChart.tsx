'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import type { ApexOptions } from 'apexcharts'
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

interface TeamComparisonChartProps {
  data: DailySummary[]
}

function TeamComparisonChart({ data }: TeamComparisonChartProps) {
  const router = useRouter()
  const theme = useUIStore((s) => s.theme)
  const isDark = DARK_THEMES.has(theme)

  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
        No data for selected date
      </div>
    )
  }

  const sorted = [...data]
    .sort(
      (a, b) =>
        b.totalLinesAdded + b.totalLinesRemoved - (a.totalLinesAdded + a.totalLinesRemoved),
    )
    .slice(0, 12)

  const series = [
    { name: 'Lines Added', data: sorted.map((d) => d.totalLinesAdded) },
    { name: 'Lines Removed', data: sorted.map((d) => d.totalLinesRemoved) },
  ]

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      background: 'transparent',
      toolbar: { show: false },
      fontFamily: 'inherit',
      stacked: true,
      events: {
        dataPointSelection: (_e, _ctx, config) => {
          const dev = sorted[config.dataPointIndex]
          if (dev?.developerAzureId) {
            router.push(`/developer/${dev.developerAzureId}`)
          }
        },
      },
    },
    plotOptions: {
      bar: { horizontal: true },
    },
    colors: ['#22c55e', '#ef4444'],
    xaxis: {
      categories: sorted.map((d) => d.displayName ?? d.developerAzureId),
      labels: {
        style: { fontSize: '11px' },
        formatter: (val) => {
          const n = parseFloat(val)
          if (!isNaN(n) && n >= 1000) return `${(n / 1000).toFixed(0)}k`
          return val
        },
      },
    },
    yaxis: {
      labels: { style: { fontSize: '11px' }, maxWidth: 120 },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '11px',
    },
    tooltip: {
      custom: ({ dataPointIndex }) => {
        const dev = sorted[dataPointIndex]
        if (!dev) return ''
        const name = dev.displayName ?? dev.developerAzureId
        const score =
          dev.avgEfficiencyScore != null ? `${dev.avgEfficiencyScore.toFixed(1)}%` : 'N/A'
        return `<div style="padding:8px 12px;font-size:12px;line-height:1.6">
          <strong>${name}</strong><br/>
          Commits: ${dev.totalCommits}<br/>
          <span style="color:#22c55e">+${dev.totalLinesAdded.toLocaleString()}</span>&nbsp;&nbsp;<span style="color:#ef4444">&#8722;${dev.totalLinesRemoved.toLocaleString()}</span> lines<br/>
          Efficiency: ${score}
        </div>`
      },
    },
    grid: { borderColor: isDark ? '#374151' : '#e5e7eb' },
    dataLabels: { enabled: false },
    theme: { mode: isDark ? 'dark' : 'light' },
  }

  return <Chart type="bar" series={series} options={options} height={320} />
}

export { TeamComparisonChart }
export default TeamComparisonChart
