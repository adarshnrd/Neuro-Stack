'use client'

import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { DailySummary } from '@/types/analytics.types'

// ── Delta cell ────────────────────────────────────────────────────────────────

function DeltaCell({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-muted-foreground">0h</span>
  }
  const label = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}h`
  return (
    <span
      className={cn(
        'font-medium tabular-nums',
        delta > 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400',
      )}
    >
      {label}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TimeAnalysisCardProps {
  summaries: DailySummary[]
  isLoading?: boolean
}

export function TimeAnalysisCard({ summaries, isLoading }: TimeAnalysisCardProps) {
  const sorted = Array.isArray(summaries)
    ? [...summaries].sort((a, b) => a.date.localeCompare(b.date))
    : []

  const totalEst = sorted.reduce((acc, s) => acc + s.totalEstimatedHours, 0)
  const totalAct = sorted.reduce((acc, s) => acc + s.totalActualHours, 0)
  const totalDelta = totalAct - totalEst

  return (
    <Card>
      <CardHeader className="px-5 pb-0 pt-4">
        <p className="text-sm font-semibold text-foreground">Time Analysis</p>
        <p className="text-xs text-muted-foreground">Estimated vs actual hours per day</p>
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
                <TableHead className="pl-5 whitespace-nowrap">Date</TableHead>
                <TableHead className="whitespace-nowrap">Repositories</TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Est. Hours
                    <InfoTooltip
                      align="right"
                      text="AI-estimated effort for this day's commits, based on the size and complexity of the code changes (lines changed, files touched, languages involved)."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    Actual Hours
                    <InfoTooltip
                      align="right"
                      text="Time the developer actually spent, taken from the linked Azure DevOps work item's tracked hours (e.g. time between Active and Closed)."
                    />
                  </span>
                </TableHead>
                <TableHead className="text-right pr-5 whitespace-nowrap">Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No time data for selected period
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sorted.map((s) => {
                    const delta = s.totalActualHours - s.totalEstimatedHours
                    const dateLabel = (() => {
                      try {
                        return format(parseISO(s.date), 'MMM d, yyyy')
                      } catch {
                        return s.date
                      }
                    })()
                    const repos = s.repositoriesWorkedOn.slice(0, 2).join(', ')
                    const repoSuffix =
                      s.repositoriesWorkedOn.length > 2
                        ? ` +${s.repositoriesWorkedOn.length - 2}`
                        : ''
                    return (
                      <TableRow key={s.date}>
                        <TableCell className="pl-5 whitespace-nowrap font-medium text-sm">
                          {dateLabel}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <span
                            className="truncate block text-xs text-muted-foreground"
                            title={s.repositoriesWorkedOn.join(', ')}
                          >
                            {repos}
                            {repoSuffix || ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {s.totalEstimatedHours.toFixed(1)}h
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {s.totalActualHours.toFixed(1)}h
                        </TableCell>
                        <TableCell className="pr-5 text-right text-sm">
                          <DeltaCell delta={delta} />
                        </TableCell>
                      </TableRow>
                    )
                  })}

                  {/* ── Summary footer ────────────────────────────────── */}
                  <TableRow className="border-t-2 border-border bg-muted/30 font-semibold">
                    <TableCell className="pl-5 text-sm" colSpan={2}>
                      Total ({sorted.length} day{sorted.length !== 1 ? 's' : ''})
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {totalEst.toFixed(1)}h
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {totalAct.toFixed(1)}h
                    </TableCell>
                    <TableCell className="pr-5 text-right text-sm">
                      <DeltaCell delta={totalDelta} />
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

export default TimeAnalysisCard
