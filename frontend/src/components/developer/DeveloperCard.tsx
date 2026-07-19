'use client'

import { ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatNumber } from '@/lib/utils'
import type { DeveloperStats } from '@/types/developer.types'

// ── Avatar helpers ────────────────────────────────────────────────────────────

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

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

interface StatChipProps {
  label: string
  value: string | number
  className?: string
}

function StatChip({ label, value, className }: StatChipProps) {
  return (
    <div className="flex flex-col items-center rounded-md border border-border bg-muted/50 px-3 py-2 min-w-[72px]">
      <span className={cn('text-base font-bold tabular-nums leading-none', className)}>
        {value}
      </span>
      <span className="mt-0.5 text-[10px] text-muted-foreground whitespace-nowrap">{label}</span>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DeveloperCardProps {
  azureId: string
  displayName?: string
  team?: string
  role?: string
  stats?: DeveloperStats
  isLoading?: boolean
}

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  manager: 'secondary',
  developer: 'outline',
}

export function DeveloperCard({
  azureId,
  displayName,
  team,
  role,
  stats,
  isLoading,
}: DeveloperCardProps) {
  const name = displayName ?? azureId
  const initials = getInitials(name)
  const bg = avatarBg(name)

  const org = process.env.NEXT_PUBLIC_AZURE_ORG
  const azureUrl = org ? `https://dev.azure.com/${org}` : '#'

  return (
    <Card>
      <CardContent className="p-5">
        {/* ── Profile row ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div
            className={cn(
              'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white',
              bg,
            )}
          >
            {initials}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-foreground">{name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {team && (
                <Badge variant="secondary" className="text-[11px] px-2 py-0 h-5">
                  {team}
                </Badge>
              )}
              {role && (
                <Badge
                  variant={ROLE_VARIANT[role] ?? 'outline'}
                  className="text-[11px] px-2 py-0 h-5 capitalize"
                >
                  {role}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground font-mono">{azureId}</span>
            </div>
          </div>

          {/* Azure DevOps link */}
          <a
            href={azureUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
          >
            <ExternalLink size={12} />
            View in Azure DevOps
          </a>
        </div>

        {/* ── Stat chips ──────────────────────────────────────────────── */}
        {stats && (
          <div className="mt-4 flex flex-wrap gap-2">
            <StatChip label="Commits" value={formatNumber(stats.totalCommits)} />
            <StatChip
              label="Lines +"
              value={`+${formatNumber(stats.totalLinesAdded)}`}
              className="text-green-600 dark:text-green-400"
            />
            <StatChip
              label="Lines −"
              value={`−${formatNumber(stats.totalLinesRemoved)}`}
              className="text-red-600 dark:text-red-400"
            />
            <StatChip label="Files" value={formatNumber(stats.totalFilesChanged)} />
            <StatChip label="PRs Merged" value={stats.prMerged} />
            <StatChip label="Tasks Done" value={stats.workItemsCompleted} />
          </div>
        )}
        {isLoading && !stats && (
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[52px] w-[72px] animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
