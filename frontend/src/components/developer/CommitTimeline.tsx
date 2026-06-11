'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { cn, scoreBadgeVariant } from '@/lib/utils'
import type { CommitRecord, PRStatus } from '@/types/commit.types'
import type { PaginatedResult } from '@/types/api.types'

// ── PR badge helpers ──────────────────────────────────────────────────────────

const PR_LABELS: Record<PRStatus, string> = {
  active: 'PR Open',
  completed: 'PR Merged',
  abandoned: 'PR Abandoned',
  draft: 'Draft PR',
}

const PR_CLASSES: Record<PRStatus, string> = {
  active: 'border-blue-500 text-blue-500',
  completed: 'border-green-600 text-green-600',
  abandoned: 'border-red-500 text-red-500',
  draft: 'border-muted-foreground text-muted-foreground',
}

// ── Single commit card ────────────────────────────────────────────────────────

function CommitCard({ commit }: { commit: CommitRecord }) {
  const [expanded, setExpanded] = useState(false)

  const ago = (() => {
    try {
      return formatDistanceToNow(parseISO(commit.pushedAt), { addSuffix: true })
    } catch {
      return '—'
    }
  })()

  const shortMsg = commit.message.length > 80 ? `${commit.message.slice(0, 80)}…` : commit.message

  return (
    <div className="border-b border-border last:border-0">
      <div className="px-5 py-3">
        {/* ── Top row ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {/* Branch badge */}
          <Badge
            variant="secondary"
            className="max-w-[140px] truncate px-1.5 py-0 text-[10px] font-mono h-5"
          >
            {commit.branchName}
          </Badge>

          <span className="flex-1" />

          <span className="text-xs text-muted-foreground">{ago}</span>

          {/* Expand / collapse */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* ── Message ───────────────────────────────────────────────── */}
        <p className="mt-1.5 font-mono text-[13px] text-foreground">{shortMsg}</p>

        {/* ── Stat chips row ────────────────────────────────────────── */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Files + lines */}
          <span className="text-xs text-muted-foreground">
            {commit.totalFilesChanged} file{commit.totalFilesChanged !== 1 ? 's' : ''}
          </span>
          <span className="text-xs font-medium text-green-600 dark:text-green-400 tabular-nums">
            +{commit.totalLinesAdded}
          </span>
          <span className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">
            −{commit.totalLinesRemoved}
          </span>

          {/* Languages (max 3) */}
          {commit.languagesUsed.slice(0, 3).map((lang) => (
            <Badge key={lang} variant="outline" className="px-1.5 py-0 text-[10px] h-4">
              {lang}
            </Badge>
          ))}
          {commit.languagesUsed.length > 3 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-4">
              +{commit.languagesUsed.length - 3}
            </Badge>
          )}

          {/* PR status */}
          {commit.prStatus ? (
            <span
              className={cn(
                'ml-auto inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium',
                PR_CLASSES[commit.prStatus],
              )}
            >
              {PR_LABELS[commit.prStatus]}
            </span>
          ) : (
            <span className="ml-auto text-[10px] text-muted-foreground">No PR</span>
          )}

          {/* AI efficiency badge */}
          {commit.analysis && (
            <Tooltip
              align="right"
              content={`${commit.analysis.complexityLevel} complexity · ${commit.analysis.technicalSummary}`}
            >
              <Badge
                variant={scoreBadgeVariant(commit.analysis.efficiencyScore)}
                className="tabular-nums"
              >
                {commit.analysis.efficiencyScore}%{' '}
                <span className="ml-0.5 text-[9px] opacity-75">
                  ({commit.analysis.complexityLevel})
                </span>
              </Badge>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Expanded: file list ───────────────────────────────────────── */}
      {expanded && commit.filesChanged && commit.filesChanged.length > 0 && (
        <div className="bg-muted/30 px-5 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 text-left font-medium">File</th>
                <th className="py-1.5 text-right font-medium">Language</th>
                <th className="py-1.5 text-right font-medium">+Added</th>
                <th className="py-1.5 text-right font-medium">−Removed</th>
              </tr>
            </thead>
            <tbody>
              {commit.filesChanged.map((f, i) => {
                return (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span title={f.filePath} className="cursor-default font-mono text-foreground">
                        {f.filePath.length > 55 ? `…${f.filePath.slice(-55)}` : f.filePath}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      {f.language && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
                          {f.language}
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 text-right font-medium text-green-600 dark:text-green-400 tabular-nums">
                      +{f.linesAdded}
                    </td>
                    <td className="py-1.5 text-right font-medium text-red-600 dark:text-red-400 tabular-nums">
                      −{f.linesRemoved}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CommitTimelineProps {
  result: PaginatedResult<CommitRecord> | undefined
  page: number
  onPageChange: (p: number) => void
  isLoading?: boolean
}

export function CommitTimeline({ result, page, onPageChange, isLoading }: CommitTimelineProps) {
  const commits = result?.items ?? []
  const totalPages = result?.totalPages ?? 1

  return (
    <Card>
      <CardHeader className="px-5 pb-0 pt-4">
        <p className="text-sm font-semibold text-foreground">Commit Timeline</p>
        {result && (
          <p className="text-xs text-muted-foreground">
            {result.total} commit{result.total !== 1 ? 's' : ''} · page {result.page} of{' '}
            {totalPages}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0 pt-3">
        {isLoading ? (
          <div className="space-y-px px-5 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full mb-2" />
            ))}
          </div>
        ) : commits.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No commits for selected date
          </p>
        ) : (
          <>
            {commits.map((c) => (
              <CommitCard key={c.id} commit={c} />
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1}
                >
                  <ChevronLeft size={14} className="mr-1" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages}
                >
                  Next
                  <ChevronRight size={14} className="ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default CommitTimeline
