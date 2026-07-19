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
import { cn, formatNumber, scoreBadgeVariant } from '@/lib/utils'
import {
  useOrgMonthly,
  useMonthDailyData,
  useTriggerMonthlySync,
  type DayEntry,
} from '@/hooks/useOrgAnalytics'
import type { MonthlySummary } from '@/types/analytics.types'

const MonthlyBarChart = dynamic<{ dayData: DayEntry[]; isLoading?: boolean }>(
  () => import('@/components/charts/MonthlyBarChart').then((m) => m.MonthlyBarChart),
  { ssr: false, loading: () => <Skeleton className="h-[360px] w-full rounded-md" /> },
)

const CommitHeatmap = dynamic<{ month: string; dayData: DayEntry[]; isLoading?: boolean }>(
  () => import('@/components/charts/CommitHeatmap').then((m) => m.CommitHeatmap),
  { ssr: false, loading: () => <Skeleton className="h-[160px] w-full rounded-md" /> },
)

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = keyof Pick<
  MonthlySummary,
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

function sortMonthly(data: MonthlySummary[], key: SortKey, dir: 'asc' | 'desc'): MonthlySummary[] {
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

function downloadMonthlyCsv(data: MonthlySummary[], month: string) {
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
  a.download = `monthly-analytics-${month}.csv`
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MonthlyAnalyticsPage() {
  const router = useRouter()
  const { selectedMonth } = useUIStore()

  const { data: monthlyRes, isLoading: monthlyLoading } = useOrgMonthly(selectedMonth)
  const { data: dayData = [], isLoading: dailyLoading } = useMonthDailyData(selectedMonth)
  const syncMonthly = useTriggerMonthlySync()

  const monthly = useMemo(() => monthlyRes?.data ?? [], [monthlyRes])

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

  const filteredMonthly = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return monthly
    return monthly.filter((r) =>
      (r.displayName ?? r.developerAzureId).toLowerCase().includes(q),
    )
  }, [monthly, searchQuery])

  const sortedMonthly = useMemo(
    () => sortMonthly(filteredMonthly, sortKey, sortDir),
    [filteredMonthly, sortKey, sortDir],
  )

  const shp = { currentKey: sortKey, currentDir: sortDir, onSort: handleSort }

  // Human-readable month label from 'YYYY-MM'
  const [y, m] = selectedMonth.split('-')
  const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  // Live feedback for the manual monthly sync.
  const syncStatus: { tone: 'ok' | 'error' | 'muted'; text: string } | null = (() => {
    if (syncMonthly.isPending) return null
    if (syncMonthly.isError) {
      const status = (syncMonthly.error as { response?: { status?: number } })?.response?.status
      return {
        tone: 'error',
        text:
          status === 409
            ? 'A sync is already running — try again in a moment.'
            : 'Sync failed. Please try again.',
      }
    }
    if (syncMonthly.isSuccess && syncMonthly.data) {
      const { upserted, updated } = syncMonthly.data
      return upserted + updated === 0
        ? { tone: 'muted', text: 'No daily data to roll up for this month yet.' }
        : { tone: 'ok', text: `Synced: ${upserted} added, ${updated} updated.` }
    }
    return null
  })()

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Monthly Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Team metrics for {monthLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMonthly.mutate(selectedMonth)}
              disabled={syncMonthly.isPending}
              title="Roll up daily activity into the monthly summary for this month"
            >
              <RefreshCw
                size={13}
                className={cn('mr-2', syncMonthly.isPending && 'animate-spin')}
              />
              {syncMonthly.isPending ? 'Syncing…' : 'Sync Now'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadMonthlyCsv(sortedMonthly, selectedMonth)}
              disabled={monthly.length === 0}
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
                syncStatus.tone === 'muted' && 'text-muted-foreground',
              )}
            >
              {syncStatus.text}
            </p>
          )}
        </div>
      </div>

      {/* ── Daily Trends Bar Chart ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold text-foreground">Daily Trends — {monthLabel}</p>
          <p className="text-xs text-muted-foreground">
            Daily trends for selected developers · toggle metric · use filter to add or remove
            people
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <MonthlyBarChart dayData={dayData} isLoading={dailyLoading} />
        </CardContent>
      </Card>

      {/* ── Commit Calendar ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold text-foreground">Commit Activity — {monthLabel}</p>
          <p className="text-xs text-muted-foreground">Org-level total commits per day</p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <CommitHeatmap month={selectedMonth} dayData={dayData} isLoading={dailyLoading} />
        </CardContent>
      </Card>

      {/* ── Monthly Summary Table ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Monthly Summary</p>
              <p className="text-xs text-muted-foreground">
                Click column header to sort · click row → developer profile
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
          {monthlyLoading ? (
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
                    column="totalLinesAdded"                  />
                  <SortableHead
                    {...shp}
                    label="Lines −"
                    column="totalLinesRemoved"                  />
                  <SortableHead
                    {...shp}
                    label="Files"
                    column="totalFilesChanged"                  />
                  <SortableHead
                    {...shp}
                    label="PRs Created"
                    column="prCreated"                  />
                  <SortableHead
                    {...shp}
                    label="PRs Merged"
                    column="prMerged"                  />
                  <SortableHead
                    {...shp}
                    label="Tasks"
                    column="workItemsCompleted"                  />
                  <SortableHead
                    {...shp}
                    label="Efficiency"
                    column="avgEfficiencyScore"
                    className="pr-5"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMonthly.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      {searchQuery.trim()
                        ? `No employees matching "${searchQuery}"`
                        : 'No data for selected month'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedMonthly.map((row, idx) => (
                    <TableRow
                      key={row.developerAzureId}
                      className="cursor-pointer"
                      onClick={() =>
                        router.push(
                          `/developer/${row.developerAzureId}?period=monthly&month=${selectedMonth}`,
                        )
                      }
                    >
                      <TableCell className="pl-5 text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.displayName ?? row.developerAzureId}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.totalCommits}</TableCell>
                      <TableCell className="tabular-nums text-green-600 dark:text-green-400">
                        +{formatNumber(row.totalLinesAdded)}
                      </TableCell>
                      <TableCell className="tabular-nums text-red-600 dark:text-red-400">
                        −{formatNumber(row.totalLinesRemoved)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.totalFilesChanged}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.prCreated}</TableCell>
                      <TableCell className="tabular-nums">{row.prMerged}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.workItemsCompleted}
                      </TableCell>
                      <TableCell className="pr-5">
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
