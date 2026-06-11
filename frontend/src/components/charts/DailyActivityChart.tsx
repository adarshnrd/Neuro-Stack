'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { ApexOptions } from 'apexcharts'
import { useUIStore } from '@/store/ui.store'
import type { DailySummary } from '@/types/analytics.types'
import { ChartScrollViewport } from '@/components/charts/ChartScrollViewport'
import { chartThemeTokens, chartTooltipShell, isDarkChartTheme } from '@/lib/chart-theme'

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

const LINES_ADDED = '#22c55e'
const LINES_REMOVED = '#ef4444'

interface DailyActivityChartProps {
  data: DailySummary[]
  date: string
}

function DailyActivityChart({ data, date }: DailyActivityChartProps) {
  const router = useRouter()
  const theme = useUIStore((s) => s.theme)
  const isDark = isDarkChartTheme(theme)
  const tokens = chartThemeTokens(isDark)

  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) =>
          b.totalLinesAdded + b.totalLinesRemoved - (a.totalLinesAdded + a.totalLinesRemoved),
      ),
    [data],
  )

  const series = useMemo(
    () => [
      { name: 'Lines Added', data: sorted.map((d) => d.totalLinesAdded) },
      { name: 'Lines Removed', data: sorted.map((d) => d.totalLinesRemoved) },
    ],
    [sorted],
  )

  const chartHeight = Math.max(280, sorted.length * 52 + 80)

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        background: 'transparent',
        foreColor: tokens.muted,
        toolbar: { show: false },
        fontFamily: 'inherit',
        stacked: true,
        events: {
          dataPointSelection: (_e, _ctx, config) => {
            const dev = sorted[config.dataPointIndex]
            if (dev?.developerAzureId) {
              router.push(`/developer/${dev.developerAzureId}?date=${date}`)
            }
          },
        },
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 3,
          borderRadiusApplication: 'end',
          barHeight: '72%',
        },
      },
      colors: [LINES_ADDED, LINES_REMOVED],
      xaxis: {
        categories: sorted.map((d) => d.displayName ?? d.developerAzureId),
        axisBorder: { color: tokens.grid },
        axisTicks: { color: tokens.grid },
        labels: {
          style: { fontSize: '11px', colors: tokens.muted },
          formatter: (val) => {
            const n = Math.abs(Number(val))
            return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)
          },
        },
      },
      yaxis: {
        labels: {
          style: { fontSize: '11px', colors: tokens.text },
          maxWidth: 140,
        },
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        fontSize: '11px',
        labels: { colors: tokens.text },
        markers: { strokeWidth: 0 },
      },
      tooltip: {
        shared: true,
        intersect: false,
        theme: isDark ? 'dark' : 'light',
        custom: ({ dataPointIndex }) => {
          const dev = sorted[dataPointIndex]
          if (!dev) return ''
          const name = dev.displayName ?? dev.developerAzureId
          const score =
            dev.avgEfficiencyScore != null ? `${dev.avgEfficiencyScore.toFixed(1)}%` : 'N/A'
          return chartTooltipShell(
            isDark,
            `<strong>${name}</strong><br/>
          Commits: <strong>${dev.totalCommits}</strong><br/>
          <span style="color:${LINES_ADDED}">+${dev.totalLinesAdded.toLocaleString()}</span>&nbsp;&nbsp;<span style="color:${LINES_REMOVED}">&#8722;${dev.totalLinesRemoved.toLocaleString()}</span> lines<br/>
          Efficiency: <strong>${score}</strong>`,
          )
        },
      },
      grid: {
        borderColor: tokens.grid,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
      },
      dataLabels: { enabled: false },
      theme: { mode: isDark ? 'dark' : 'light' },
    }),
    [sorted, isDark, tokens, date, router],
  )

  if (data.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        No developer activity for selected date
      </div>
    )
  }

  return (
    <ChartScrollViewport itemCount={sorted.length}>
      <Chart
        key={theme}
        type="bar"
        series={series}
        options={options}
        height={chartHeight}
      />
    </ChartScrollViewport>
  )
}

export { DailyActivityChart }
export default DailyActivityChart
