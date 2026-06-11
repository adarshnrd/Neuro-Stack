'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Download, ArrowUp, ArrowDown, ChevronsUpDown, Search, X, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useUIStore } from '@/store/ui.store'
import { cn, formatDate, formatNumber, scoreBadgeVariant } from '@/lib/utils'
import { useOrgDaily, useOrgPrEffort, useTriggerDailySync } from '@/hooks/useOrgAnalytics'
import type { DailySummary, OrgDailyEffort } from '@/types/analytics.types'

const DailyEffortChart = dynamic<{ data: OrgDailyEffort[]; date: string }>(
  () => import('@/components/charts/DailyEffortChart').then((m) => m.DailyEffortChart),
  { ssr: false, loading: () => <Skeleton className="h-[280px] w-full rounded-md" /> },
)

const DailyActivityChart = dynamic<{ data: DailySummary[]; date: string }>(
  () => import('@/components/charts/DailyActivityChart').then((m) => m.DailyActivityChart),
  { ssr: false, loading: () => <Skeleton className="h-[360px] w-full rounded-md" /> },
)

// ── Types & sort ──────────────────────────────────────────────────────────────

type SortKey = keyof Pick<
  DailySummary,
  | 'displayName'
  | 'totalCommits'
  | 'totalLinesAdded'
  | 'totalLinesRemoved'
  | 'totalFilesChanged'
  | 'prCreated'
  | 'prMerged'
  | 'workItemsCompleted'
  | 'avgEfficiencyScore'
>

function sortData(data: DailySummary[], key: SortKey, dir: 'asc' | 'desc'): DailySummary[] {
  return [...data].sort((a, b) => {
    if (key === 'displayName') {
      const an = a.displayName ?? a.developerAzureId
      const bn = b.displayName ?? b.developerAzureId
      return dir === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an)
    }
    const av = (a[key] ?? (key === 'avgEfficiencyScore' ? -Infinity : 0)) as number
    const bv = (b[key] ?? (key === 'avgEfficiencyScore' ? -Infinity : 0)) as number
    return dir === 'asc' ? av - bv : bv - av
  })
}

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCsv(data: DailySummary[], date: string) {
  const headers = [
    'Rank',
    'Developer',
    'Commits',
    'Lines Added',
    'Lines Removed',
    'Files Changed',
    'PRs Created',
    'PRs Merged',
    'Tasks Done',
    'Efficiency Score',
  ]
  const rows = data.map((d, i) => [
    i + 1,
    `"${(d.displayName ?? d.developerAzureId).replace(/"/g, '""')}"`,
    d.totalCommits,
    d.totalLinesAdded,
    d.totalLinesRemoved,
    d.totalFilesChanged,
    d.prCreated,
    d.prMerged,
    d.workItemsCompleted,
    d.avgEfficiencyScore?.toFixed(1) ?? '',
  ])
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `daily-analytics-${date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Sortable table head ───────────────────────────────────────────────────────

interface SortableHeadProps {
  label: string
  column: SortKey
  currentKey: SortKey
  currentDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  className?: string
}

function SortableHead({
  label,
  column,
  currentKey,
  currentDir,
  onSort,
  className,
}: SortableHeadProps) {
  const active = currentKey === column
  const Icon = active ? (currentDir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <TableHead
      className={cn('cursor-pointer select-none whitespace-nowrap', className)}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon size={12} className={active ? 'text-foreground' : 'opacity-30'} />
      </div>
    </TableHead>
  )
}

/** Local-timezone today as YYYY-MM-DD (matches how selectedDate is seeded). */
function localTodayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DailyAnalyticsPage() {
  const router = useRouter()
  const { selectedDate } = useUIStore()
  const { data: res, isLoading } = useOrgDaily(selectedDate)
  const { data: effortRes, isLoading: effortLoading } = useOrgPrEffort(selectedDate)
  const isToday = selectedDate === localTodayStr()
  const syncDaily = useTriggerDailySync()

  const syncStatus: { tone: 'ok' | 'error'; text: string } | null = (() => {
    if (syncDaily.isPending) return null
    if (syncDaily.isError) {
      const status = (syncDaily.error as { response?: { status?: number } })?.response?.status
      return {
        tone: 'error',
        text:
          status === 409
            ? 'A rebuild is already running — try again in a moment.'
            : 'Sync failed. Please try again.',
      }
    }
    if (syncDaily.isSuccess && syncDaily.data) {
      return { tone: 'ok', text: `Synced ${syncDaily.data.developers} developer(s).` }
    }
    return null
  })()
  const daily = useMemo(() => res?.data ?? [], [res])
  const effortData = useMemo(() => effortRes?.data ?? [], [effortRes])

  const [sortKey, setSortKey] = useState<SortKey>('avgEfficiencyScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return daily
    return daily.filter((r) =>
      (r.displayName ?? r.developerAzureId).toLowerCase().includes(q),
    )
  }, [daily, searchQuery])

  const sortedData = useMemo(
    () => sortData(filteredData, sortKey, sortDir),
    [filteredData, sortKey, sortDir],
  )

  const shp = { currentKey: sortKey, currentDir: sortDir, onSort: handleSort }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-foreground">Daily Analytics</h1>
            {isToday && (
              <span
                title="Auto-refreshing every 20s"
                className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Team metrics for {formatDate(selectedDate)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncDaily.mutate(selectedDate)}
              disabled={syncDaily.isPending}
              title="Recompute every developer's activity for this day"
            >
              <RefreshCw size={13} className={cn('mr-2', syncDaily.isPending && 'animate-spin')} />
              {syncDaily.isPending ? 'Syncing…' : 'Sync Now'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(sortedData, selectedDate)}
              disabled={daily.length === 0}
            >
              <Download size={13} className="mr-2" />
              Export CSV
            </Button>
          </div>
          {syncStatus && (
            <p
              className={cn(
                'text-xs',
                syncStatus.tone === 'ok' && 'text-green-600 dark:text-green-400',
                syncStatus.tone === 'error' && 'text-red-600 dark:text-red-400',
              )}
            >
              {syncStatus.text}
            </p>
          )}
        </div>
      </div>

      {/* ── Work hours summary ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold text-foreground">Work Hours: Estimated vs Reported</p>
          <p className="text-xs text-muted-foreground">
            Blue = AI-estimated · Emerald = developer-reported · Click bar → developer profile ·
            Scroll chart to see all developers
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {effortLoading ? (
            <Skeleton className="h-[280px] w-full rounded-md" />
          ) : (
            <DailyEffortChart data={effortData} date={selectedDate} />
          )}
        </CardContent>
      </Card>

      {/* ── Chart ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold text-foreground">Lines Changed by Developer</p>
          <p className="text-xs text-muted-foreground">
            Green = lines added · Red = lines removed · Click bar → developer profile · Scroll
            chart to see all developers
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-[360px] w-full rounded-md" />
          ) : (
            <DailyActivityChart data={filteredData} date={selectedDate} />
          )}
        </CardContent>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Developer Details</p>
              <p className="text-xs text-muted-foreground">
                Click column header to sort · Click row → developer profile
              </p>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search employees…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-52 pl-8 pr-7 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {isLoading ? (
            <div className="space-y-3 px-5 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-5">#</TableHead>
                  <SortableHead {...shp} label="Developer" column="displayName" />
                  <SortableHead {...shp} label="Commits" column="totalCommits" />
                  <SortableHead
                    {...shp}
                    label="Lines +"
                    column="totalLinesAdded"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="Lines −"
                    column="totalLinesRemoved"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="Files"
                    column="totalFilesChanged"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="PRs Created"
                    column="prCreated"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="PRs Merged"
                    column="prMerged"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="Tasks"
                    column="workItemsCompleted"
                    className="text-right"
                  />
                  <SortableHead
                    {...shp}
                    label="Efficiency"
                    column="avgEfficiencyScore"
                    className="pr-5 text-right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      {searchQuery.trim()
                        ? `No employees matching "${searchQuery}"`
                        : 'No activity recorded for this date'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedData.map((row, idx) => (
                    <TableRow
                      key={row.developerAzureId}
                      className="cursor-pointer"
                      onClick={() => router.push(`/developer/${row.developerAzureId}`)}
                    >
                      <TableCell className="pl-5 text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.displayName ?? row.developerAzureId}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.totalCommits}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">
                        +{formatNumber(row.totalLinesAdded)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                        −{formatNumber(row.totalLinesRemoved)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.totalFilesChanged}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.prCreated}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.prMerged}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.workItemsCompleted}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Badge
                          variant={scoreBadgeVariant(row.avgEfficiencyScore)}
                          className="tabular-nums"
                        >
                          {row.avgEfficiencyScore != null
                            ? `${row.avgEfficiencyScore.toFixed(1)}%`
                            : '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
