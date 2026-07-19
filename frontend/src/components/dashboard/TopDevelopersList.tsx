'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, scoreColour, scoreBadgeVariant } from '@/lib/utils'
import type { DailySummary } from '@/types/analytics.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-rose-500',
]

function avatarBg(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function progressBg(score: number | null): string {
  if (score == null) return 'bg-muted-foreground/30'
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TopDevelopersListProps {
  performers: DailySummary[]
  isLoading?: boolean
}

export function TopDevelopersList({ performers, isLoading }: TopDevelopersListProps) {
  const sorted = [...performers]
    .sort((a, b) => (b.avgEfficiencyScore ?? -1) - (a.avgEfficiencyScore ?? -1))
    .slice(0, 5)

  return (
    <Card>
      <CardHeader className="px-4 pb-2 pt-4">
        <CardTitle className="text-sm font-semibold">Top Performers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-5 w-4 shrink-0" />
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
              <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">No data available</p>
        ) : (
          sorted.map((dev, idx) => {
            const name = dev.displayName ?? dev.developerAzureId
            const score = dev.avgEfficiencyScore
            const bg = avatarBg(name)
            const ini = initials(name)

            return (
              <div key={dev.developerAzureId} className="flex items-center gap-2">
                {/* Rank */}
                <span className="w-4 shrink-0 text-center text-xs font-bold text-muted-foreground">
                  {idx + 1}
                </span>

                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                    bg,
                  )}
                >
                  {ini}
                </div>

                {/* Name + progress bar */}
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-xs font-medium', scoreColour(score))}>{name}</p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        progressBg(score),
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }}
                    />
                  </div>
                </div>

                {/* Score badge */}
                <Badge
                  variant={scoreBadgeVariant(score)}
                  className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums"
                >
                  {score != null ? `${score.toFixed(1)}%` : '—'}
                </Badge>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
