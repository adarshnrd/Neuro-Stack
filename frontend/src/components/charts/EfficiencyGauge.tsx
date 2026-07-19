'use client'

import dynamic from 'next/dynamic'
import type { ApexOptions } from 'apexcharts'
import { useUIStore } from '@/store/ui.store'

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

const DARK_THEMES = new Set([
  'theme-dark',
  'theme-dim',
  'theme-nord',
  'theme-dracula',
  'theme-high-contrast',
])

interface EfficiencyGaugeProps {
  score: number | null
  label?: string
}

function EfficiencyGauge({ score, label = 'Efficiency Score' }: EfficiencyGaugeProps) {
  const theme = useUIStore((s) => s.theme)
  const isDark = DARK_THEMES.has(theme)

  const value = score ?? 0
  const fillColor =
    score == null ? '#9ca3af' : value < 50 ? '#ef4444' : value < 75 ? '#f59e0b' : '#22c55e'

  const series = [value]

  const options: ApexOptions = {
    chart: {
      type: 'radialBar',
      background: 'transparent',
      toolbar: { show: false },
      fontFamily: 'inherit',
      animations: {
        enabled: true,
        speed: 800,
      },
    },
    plotOptions: {
      radialBar: {
        hollow: { size: '62%' },
        track: {
          background: isDark ? '#374151' : '#e5e7eb',
          strokeWidth: '100%',
        },
        dataLabels: {
          name: {
            show: true,
            fontSize: '11px',
            color: isDark ? '#9ca3af' : '#6b7280',
            fontWeight: 'normal',
            offsetY: 22,
          },
          value: {
            show: true,
            fontSize: '26px',
            fontWeight: 'bold',
            color: isDark ? '#f1f5f9' : '#1e293b',
            offsetY: -8,
            formatter: () => (score != null ? `${Math.round(value)}%` : 'N/A'),
          },
        },
      },
    },
    fill: { colors: [fillColor] },
    labels: [label],
    stroke: { lineCap: 'round' },
    theme: { mode: isDark ? 'dark' : 'light' },
  }

  return <Chart type="radialBar" series={series} options={options} height={200} />
}

export { EfficiencyGauge }
export default EfficiencyGauge
