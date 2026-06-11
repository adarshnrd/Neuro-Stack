'use client'

import type { ReactNode } from 'react'

interface ChartScrollViewportProps {
  itemCount: number
  children: ReactNode
  maxHeight?: number
  rowHeight?: number
  headerPad?: number
  minChartHeight?: number
}

function ChartScrollViewport({
  itemCount,
  children,
  maxHeight = 420,
  rowHeight = 52,
  headerPad = 80,
  minChartHeight = 280,
}: ChartScrollViewportProps) {
  const chartHeight = Math.max(minChartHeight, itemCount * rowHeight + headerPad)
  const rowsInViewport = Math.floor((maxHeight - headerPad) / rowHeight)
  const needsScroll = itemCount > rowsInViewport

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {itemCount} developer{itemCount !== 1 ? 's' : ''}
        {needsScroll ? ' — scroll to see all' : ''}
      </p>
      <div
        className="overflow-y-auto rounded-md"
        style={{ maxHeight: needsScroll ? maxHeight : chartHeight }}
      >
        {children}
      </div>
    </div>
  )
}

export { ChartScrollViewport }
export default ChartScrollViewport
