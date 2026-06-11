'use client'

import { Info } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'

interface InfoTooltipProps {
  text: string
  className?: string
  align?: 'left' | 'right'
  /** Which side of the icon the tooltip opens on. Default 'bottom' — table
   *  headers live inside an `overflow-auto` wrapper, so 'top' gets clipped. */
  side?: 'top' | 'bottom'
}

/** Small hover-activated info icon with a tooltip. */
export function InfoTooltip({ text, className, align = 'left', side = 'bottom' }: InfoTooltipProps) {
  return (
    <Tooltip content={text} align={align} side={side} className={className}>
      <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-muted-foreground" />
    </Tooltip>
  )
}

export default InfoTooltip
