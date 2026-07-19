'use client'

import { ArrowUp, ArrowDown, Minus, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  delta?: number
  deltaType?: 'up' | 'down' | 'neutral'
  icon: LucideIcon
  suffix?: string
  isLoading?: boolean
}

export function KpiCard({
  label,
  value,
  delta,
  deltaType,
  icon: Icon,
  suffix,
  isLoading,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-2 h-3 w-24" />
        </CardContent>
      </Card>
    )
  }

  const effectiveDeltaType: 'up' | 'down' | 'neutral' =
    deltaType ?? (delta != null ? (delta >= 0 ? 'up' : 'down') : 'neutral')

  const deltaColour =
    effectiveDeltaType === 'up'
      ? 'text-green-600 dark:text-green-400'
      : effectiveDeltaType === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground'

  const DeltaIcon =
    effectiveDeltaType === 'up' ? ArrowUp : effectiveDeltaType === 'down' ? ArrowDown : Minus

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className="rounded-md bg-muted p-1.5 shrink-0">
            <Icon size={15} className="text-muted-foreground" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums leading-none text-foreground">
            {value}
          </span>
          {suffix && <span className="text-base font-medium text-muted-foreground">{suffix}</span>}
        </div>

        <div className={cn('mt-2 flex items-center gap-0.5 text-xs font-medium', deltaColour)}>
          {delta != null ? (
            <>
              <DeltaIcon size={11} />
              <span>{Math.abs(delta)}% vs week avg</span>
            </>
          ) : (
            <span className="text-muted-foreground/0 select-none">—</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
