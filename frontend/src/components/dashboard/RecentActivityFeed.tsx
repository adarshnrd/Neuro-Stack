'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatRelativeDay } from '@/lib/utils'
import type { DailySummary } from '@/types/analytics.types'

// ── Avatar helpers (shared pattern across dashboard components) ───────────────

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

// ── Single activity row ───────────────────────────────────────────────────────

function ActivityRow({ item }: { item: DailySummary }) {
  const name = item.displayName ?? item.developerAzureId
  const bg = avatarBg(name)
  const ini = initials(name)

  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      {/* Avatar */}
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
          bg,
        )}
      >
        {ini}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Name + time */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="text-xs text-muted-foreground">
            {item.totalCommits} commit{item.totalCommits !== 1 ? 's' : ''}
            {' · '}
            {formatRelativeDay(item.date)}
          </span>
        </div>

        {/* Repo badges */}
        {item.repositoriesWorkedOn.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.repositoriesWorkedOn.slice(0, 3).map((repo) => (
              <Badge key={repo} variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {repo}
              </Badge>
            ))}
            {item.repositoriesWorkedOn.length > 3 && (
              <span className="self-center text-[10px] text-muted-foreground">
                +{item.repositoriesWorkedOn.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Lines diff */}
        <div className="mt-1 flex items-center gap-2.5 text-xs">
          <span className="font-medium text-green-600 dark:text-green-400">
            +{item.totalLinesAdded.toLocaleString()}
          </span>
          <span className="font-medium text-red-600 dark:text-red-400">
            −{item.totalLinesRemoved.toLocaleString()}
          </span>
          {item.totalFilesChanged > 0 && (
            <span className="text-muted-foreground">
              {item.totalFilesChanged} file{item.totalFilesChanged !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Feed loading state ────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-border py-3 last:border-0">
          <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface RecentActivityFeedProps {
  items: DailySummary[]
  isLoading?: boolean
}

export function RecentActivityFeed({ items, isLoading }: RecentActivityFeedProps) {
  const sorted = [...items].sort((a, b) => b.totalCommits - a.totalCommits)

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h3>
      <Card className="max-h-[400px] overflow-y-auto px-4">
        {isLoading ? (
          <FeedSkeleton />
        ) : sorted.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No activity for selected date
          </p>
        ) : (
          sorted.map((item) => <ActivityRow key={item.developerAzureId} item={item} />)
        )}
      </Card>
    </div>
  )
}
