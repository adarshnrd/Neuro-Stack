'use client'

import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  children: React.ReactNode
  className?: string
  align?: 'left' | 'right'
  /** Which side the tooltip opens on. Default 'bottom' — elements inside an
   *  `overflow-auto` wrapper (e.g. tables) get the 'top' side clipped. */
  side?: 'top' | 'bottom'
}

/** Hover-activated tooltip — pure CSS, no extra deps, theme-aware colors. */
export function Tooltip({ content, children, className, align = 'left', side = 'bottom' }: TooltipProps) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-64 whitespace-normal break-words rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {content}
      </span>
    </span>
  )
}

export default Tooltip
