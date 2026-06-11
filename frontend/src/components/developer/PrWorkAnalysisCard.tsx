'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, GitCommit, LinkIcon } from 'lucide-react'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Tooltip } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDeveloperPrCommits } from '@/hooks/useDeveloperStats'
import { cn } from '@/lib/utils'
import type { PrEffort, PrCommit } from '@/types/analytics.types'

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Hours → human label: sub-hour shows minutes (rounded to 5), else "X.Xh". */
function fmtHours(h: number): string {
  if (h <= 0) return '0m'
  if (h < 1) {
    const mins = Math.max(5, Math.round((h * 60) / 5) * 5)
    return `${mins}m`
  }
  return `${h.toFixed(1)}h`
}

// ── Efficiency cell ──────────────────────────────────────────────────────────

function EfficiencyCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>
  const color =
    score >= 75
      ? 'text-green-600 dark:text-green-400'
      : score >= 50
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-500'
  return <span className={cn('font-medium tabular-nums', color)}>{score}</span>
}

// ── Variance cell ────────────────────────────────────────────────────────────

function VarianceCell({ percent }: { percent: number | null }) {
  if (percent == null) {
    return <span className="text-muted-foreground">—</span>
  }
  if (percent === 0) {
    return <span className="text-muted-foreground">0%</span>
  }
  // Over budget (took longer than expected) = red; under/aligned = green.
  const over = percent > 0
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        over ? 'text-red-500' : 'text-green-600 dark:text-green-400',
      )}
    >
      {over ? '+' : ''}
      {percent}%
    </span>
  )
}

// ── Actual cell (handles late-binding state) ─────────────────────────────────

function ActualCell({ pr }: { pr: PrEffort }) {
  // No work item linked yet → prompt to link one (unlocks the actual-hours
  // comparison). Keyed off the work item itself, NOT actualHours — a linked
  // work item with no logged time must not be told to "link a work item".
  if (pr.workItemIds.length === 0) {
    return (
      <Tooltip
        align="right"
        content="This PR has no work item linked yet, so we can't measure the developer's real effort. Tag a work item to the PR to unlock the actual-hours comparison."
      >
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <LinkIcon size={11} />
          Link a work item
        </span>
      </Tooltip>
    )
  }

  // Work item linked, but no actual hours available yet — the work item has no
  // logged time and there's no commit activity to estimate from.
  if (pr.actualHours == null) {
    return (
      <Tooltip
        align="right"
        content="A work item is linked, but no actual hours are available yet — the work item has no logged time and there's no commit activity to estimate the effort from."
      >
        <span className="tabular-nums text-muted-foreground">—</span>
      </Tooltip>
    )
  }

  const sourceLabel =
    pr.actualSource === 'work-item-logged'
      ? 'From the linked work item'
      : 'Estimated from commit activity'
  return (
    <Tooltip align="right" content={sourceLabel}>
      <span className="tabular-nums">{fmtHours(pr.actualHours)}</span>
    </Tooltip>
  )
}

// ── Commit-history timeline (lazy-loaded per PR) ──────────────────────────────

/** Human bucket label + sort key for a commit's push date. */
function dateBucket(iso: string): { key: string; label: string } {
  const d = parseISO(iso)
  const key = format(d, 'yyyy-MM-dd')
  if (isToday(d)) return { key, label: 'Today' }
  if (isYesterday(d)) return { key, label: 'Yesterday' }
  return { key, label: format(d, 'EEE, MMM d, yyyy') }
}

/** Group commits into consecutive day buckets, most-recent push first. */
function groupByDay(commits: PrCommit[]) {
  const sorted = [...commits].sort(
    (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
  )
  const groups: { key: string; label: string; commits: PrCommit[] }[] = []
  for (const c of sorted) {
    const { key, label } = dateBucket(c.pushedAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.commits.push(c)
    else groups.push({ key, label, commits: [c] })
  }
  return groups
}

function CommitRow({ commit }: { commit: PrCommit }) {
  const time = (() => {
    try {
      return format(parseISO(commit.pushedAt), 'h:mm a')
    } catch {
      return '—'
    }
  })()
  const shortMsg =
    commit.message.length > 90 ? `${commit.message.slice(0, 90)}…` : commit.message || '(no message)'

  return (
    <li className="relative pl-6 pb-4 last:pb-0">
      {/* Timeline rail + node */}
      <span className="absolute left-[5px] top-1 bottom-0 w-px bg-border" aria-hidden />
      <span className="absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 border-primary bg-card" aria-hidden />

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium tabular-nums text-foreground">{time}</span>
        <Badge
          variant="secondary"
          className="max-w-[160px] truncate px-1.5 py-0 text-[10px] font-mono h-4"
        >
          {commit.branchName || '—'}
        </Badge>
        <span className="font-mono text-[11px] text-green-600 dark:text-green-400 tabular-nums">
          +{commit.totalLinesAdded}
        </span>
        <span className="font-mono text-[11px] text-red-600 dark:text-red-400 tabular-nums">
          −{commit.totalLinesRemoved}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {commit.totalFilesChanged} file{commit.totalFilesChanged !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-[12px] text-foreground">{shortMsg}</p>
    </li>
  )
}

function PrCommitTimeline({ azureId, azurePrId }: { azureId: string; azurePrId: string }) {
  const { data, isLoading } = useDeveloperPrCommits(azureId, azurePrId)
  const commits = data?.data ?? []

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No commits have been pushed to this PR yet.
      </p>
    )
  }

  const groups = groupByDay(commits)

  return (
    <div className="space-y-4 py-1">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{g.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {g.commits.length} commit{g.commits.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="ml-1">
            {g.commits.map((c) => (
              <CommitRow key={c.azureCommitId} commit={c} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ── Commits cell (count + expand affordance) ─────────────────────────────────

function CommitsCell({ count, expanded }: { count: number; expanded: boolean }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
      {expanded ? (
        <ChevronDown size={13} className="text-muted-foreground" />
      ) : (
        <ChevronRight size={13} className="text-muted-foreground" />
      )}
      <GitCommit size={13} className="text-muted-foreground" />
      {count}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PrWorkAnalysisCardProps {
  azureId: string
  prs: PrEffort[]
  isLoading?: boolean
}

export function PrWorkAnalysisCard({ azureId, prs, isLoading }: PrWorkAnalysisCardProps) {
  const rows = Array.isArray(prs) ? prs : []
  const [expandedPrId, setExpandedPrId] = useState<string | null>(null)

  const totalEst = rows.reduce((acc, p) => acc + (p.estimatedHours ?? 0), 0)
  const totalAct = rows.reduce((acc, p) => acc + (p.actualHours ?? 0), 0)
  const totalCommits = rows.reduce((acc, p) => acc + (p.commitCount ?? 0), 0)
  const measuredCount = rows.filter((p) => p.actualHours != null).length

  const toggle = (id: string) => setExpandedPrId((cur) => (cur === id ? null : id))

  return (
    <Card>
      <CardHeader className="px-5 pb-0 pt-4">
        <p className="text-sm font-semibold text-foreground">PR Work Analysis</p>
        <p className="text-xs text-muted-foreground">
          AI-estimated vs actual effort, per pull request — open a PR for its commit history
        </p>
      </CardHeader>
      <CardContent className="p-0 pb-2 pt-3">
        {isLoading ? (
          <div className="space-y-2 px-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="pl-5 whitespace-nowrap">PR Name</TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Commits
                    <InfoTooltip
                      align="right"
                      text="Total commits pushed to this PR. Open the row to see the full commit history timeline — what was pushed today, yesterday, and on earlier dates."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Estimated Hours
                    <InfoTooltip
                      align="right"
                      text="A single AI estimate of how long this PR's work should take, judged from the actual code changes (net diff) plus the linked work item."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Efficiency
                    <InfoTooltip
                      align="right"
                      text="AI code-quality score (0–100) of the delivered code for this PR — clean, well-scoped solutions score higher; over-engineering/duplication/risky changes score lower. Independent of time."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Actual Hours
                    <InfoTooltip
                      align="right"
                      text="The developer's real effort — taken from the linked work item's logged time when available, otherwise estimated from the spacing of the PR's commits (idle/overnight gaps excluded)."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right pr-5 whitespace-nowrap">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No pull requests for selected period
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {rows.map((pr) => {
                    const expanded = expandedPrId === pr.azurePrId
                    return (
                      <Fragment key={pr.azurePrId}>
                        <TableRow
                          onClick={() => toggle(pr.azurePrId)}
                          className="cursor-pointer"
                          aria-expanded={expanded}
                        >
                          <TableCell className="max-w-[320px] pl-5">
                            <Tooltip content={pr.aiExplanation || pr.prTitle}>
                              <span className="block truncate text-sm font-medium text-foreground">
                                {pr.prTitle}
                              </span>
                            </Tooltip>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {pr.repositoryName}
                              {pr.workItemIds.length > 0
                                ? ` · WI ${pr.workItemIds.join(', ')}`
                                : ' · no work item'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <CommitsCell count={pr.commitCount ?? 0} expanded={expanded} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmtHours(pr.estimatedHours ?? 0)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <EfficiencyCell score={pr.efficiencyScore} />
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <ActualCell pr={pr} />
                          </TableCell>
                          <TableCell className="pr-5 text-right text-sm">
                            <VarianceCell percent={pr.variancePercent} />
                          </TableCell>
                        </TableRow>

                        {expanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={6} className="px-5 py-2">
                              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Commit history
                              </p>
                              <PrCommitTimeline azureId={azureId} azurePrId={pr.azurePrId} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}

                  {/* ── Summary footer ────────────────────────────────── */}
                  <TableRow className="border-t-2 border-border bg-muted/30 font-semibold">
                    <TableCell className="pl-5 text-sm">
                      Total ({rows.length} PR{rows.length !== 1 ? 's' : ''}
                      {measuredCount < rows.length ? `, ${measuredCount} measured` : ''})
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {totalCommits}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtHours(totalEst)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {measuredCount > 0 ? fmtHours(totalAct) : '—'}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-sm text-muted-foreground">
                      —
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default PrWorkAnalysisCard
