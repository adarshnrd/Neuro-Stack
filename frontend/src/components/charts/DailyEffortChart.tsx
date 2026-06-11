'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { ApexOptions } from 'apexcharts'
import { useUIStore } from '@/store/ui.store'
import type { OrgDailyEffort } from '@/types/analytics.types'
import { ChartScrollViewport } from '@/components/charts/ChartScrollViewport'
import {
  CHART_EFFORT_ESTIMATED,
  CHART_EFFORT_REPORTED,
  chartThemeTokens,
  chartTooltipShell,
  isDarkChartTheme,
} from '@/lib/chart-theme'

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

interface DailyEffortChartProps {
  data: OrgDailyEffort[]
  date: string
}

function fmtHours(h: number): string {
  if (h <= 0) return '0h'
  if (h < 1) {
    const mins = Math.max(5, Math.round((h * 60) / 5) * 5)
    return `${mins}m`
  }
  return `${h.toFixed(1)}h`
}

function DailyEffortChart({ data, date }: DailyEffortChartProps) {
  const router = useRouter()
  const theme = useUIStore((s) => s.theme)
  const isDark = isDarkChartTheme(theme)
  const tokens = chartThemeTokens(isDark)

  const sorted = useMemo(
    () =>
      [...data].sort((a, b) => {
        const aKey = a.reportedHours > 0 ? a.reportedHours : a.estimatedHours
        const bKey = b.reportedHours > 0 ? b.reportedHours : b.estimatedHours
        return bKey - aKey
      }),
    [data],
  )

  const series = useMemo(
    () => [
      { name: 'Estimated', data: sorted.map((d) => d.estimatedHours) },
      { name: 'Reported', data: sorted.map((d) => d.reportedHours) },
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
          dataLabels: {
            position: 'top',
          },
        },
      },
      colors: [CHART_EFFORT_ESTIMATED, CHART_EFFORT_REPORTED],
      xaxis: {
        categories: sorted.map((d) => d.displayName ?? d.developerAzureId),
        axisBorder: { color: tokens.grid },
        axisTicks: { color: tokens.grid },
        labels: {
          style: { fontSize: '11px', colors: tokens.muted },
          formatter: (val) => {
            const n = Number(val)
            return n >= 1 ? `${n.toFixed(1)}h` : `${Math.round(n * 60)}m`
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
          const efficiency =
            dev.avgEfficiencyScore != null ? `${dev.avgEfficiencyScore.toFixed(0)}` : 'N/A'
          const variance =
            dev.variancePercent != null
              ? `${dev.variancePercent > 0 ? '+' : ''}${dev.variancePercent}%`
              : dev.measuredPrCount === 0
                ? 'Not reported'
                : 'N/A'
          const varianceColor =
            dev.variancePercent != null && dev.variancePercent > 0 ? '#ef4444' : '#22c55e'
          return chartTooltipShell(
            isDark,
            `<strong>${name}</strong><br/>
          <span style="color:${CHART_EFFORT_ESTIMATED}">Estimated: <strong>${fmtHours(dev.estimatedHours)}</strong></span><br/>
          <span style="color:${CHART_EFFORT_REPORTED}">Reported: <strong>${dev.measuredPrCount > 0 ? fmtHours(dev.reportedHours) : 'Not reported'}</strong></span><br/>
          PRs: <strong>${dev.prCount}</strong> (${dev.measuredPrCount} measured)<br/>
          Efficiency: <strong>${efficiency}</strong><br/>
          Variance: <strong style="color:${varianceColor}">${variance}</strong>`,
          )
        },
      },
      grid: {
        borderColor: tokens.grid,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
      },
      dataLabels: {
        enabled: true,
        style: {
          fontSize: '10px',
          fontWeight: 600,
          colors: [tokens.dataLabel],
        },
        background: {
          enabled: true,
          foreColor: tokens.dataLabel,
          backgroundColor: isDark ? '#1e293b' : '#ffffff',
          borderRadius: 2,
          padding: 4,
          borderWidth: 0,
          opacity: isDark ? 0.8 : 0.92,
        },
        dropShadow: { enabled: false },
        formatter: (val) => {
          const n = Number(val)
          if (n <= 0) return ''
          return fmtHours(n)
        },
        offsetX: 4,
      },
      theme: { mode: isDark ? 'dark' : 'light' },
    }),
    [sorted, isDark, tokens, date, router],
  )

  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No PR effort data for selected date
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

export { DailyEffortChart }
export default DailyEffortChart
