'use client'

import { Suspense, useMemo, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { DeveloperCard } from '@/components/developer/DeveloperCard'
import { ProjectBreakdown } from '@/components/developer/ProjectBreakdown'
import { CommitTimeline } from '@/components/developer/CommitTimeline'
import { PrWorkAnalysisCard } from '@/components/developer/PrWorkAnalysisCard'
import { useUIStore } from '@/store/ui.store'
import { cn } from '@/lib/utils'
import {
  useDeveloperOverview,
  useDeveloperCommits,
  useDeveloperProjects,
  useDeveloperProfile,
  useDeveloperPrEffort,
} from '@/hooks/useDeveloperStats'
import type { DailySummary } from '@/types/analytics.types'
import type { DeveloperStats } from '@/types/developer.types'
import { GitCommit, TrendingUp, TrendingDown, Gauge } from 'lucide-react'

// ── Dynamic chart imports ─────────────────────────────────────────────────────

const EfficiencyGauge = dynamic<{ score: number | null; label?: string }>(
  () => import('@/components/charts/EfficiencyGauge').then((m) => m.EfficiencyGauge),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-md" /> },
)

const LinesOfCodeChart = dynamic<{ summaries: DailySummary[] }>(
  () => import('@/components/charts/LinesOfCodeChart').then((m) => m.LinesOfCodeChart),
  { ssr: false, loading: () => <Skeleton className="h-[240px] w-full rounded-md" /> },
)

const CommitHeatmap = dynamic<{
  month: string
  commitValues?: { date: string; count: number }[]
  isLoading?: boolean
}>(
  () => import('@/components/charts/CommitHeatmap').then((m) => m.CommitHeatmap),
  { ssr: false, loading: () => <Skeleton className="h-[160px] w-full rounded-md" /> },
)

// ── Aggregate helpers ─────────────────────────────────────────────────────────

function aggregateStats(summaries: DailySummary[], azureId: string): DeveloperStats {
  const scores = summaries.map((s) => s.avgEfficiencyScore).filter((v): v is number => v != null)
  return {
    developerAzureId: azureId,
    displayName: summaries[0]?.displayName,
    totalCommits: summaries.reduce((a, s) => a + s.totalCommits, 0),
    totalLinesAdded: summaries.reduce((a, s) => a + s.totalLinesAdded, 0),
    totalLinesRemoved: summaries.reduce((a, s) => a + s.totalLinesRemoved, 0),
    totalFilesChanged: summaries.reduce((a, s) => a + s.totalFilesChanged, 0),
    repositoriesWorkedOn: [...new Set(summaries.flatMap((s) => s.repositoriesWorkedOn))],
    avgEfficiencyScore: scores.length ? scores.reduce((a, v) => a + v, 0) / scores.length : null,
    totalEstimatedHours: summaries.reduce((a, s) => a + s.totalEstimatedHours, 0),
    totalActualHours: summaries.reduce((a, s) => a + s.totalActualHours, 0),
    prCreated: summaries.reduce((a, s) => a + s.prCreated, 0),
    prMerged: summaries.reduce((a, s) => a + s.prMerged, 0),
    workItemsCompleted: summaries.reduce((a, s) => a + s.workItemsCompleted, 0),
  }
}

// ── Period toggle ─────────────────────────────────────────────────────────────

interface PeriodToggleProps {
  period: 'daily' | 'monthly'
  onToggle: (p: 'daily' | 'monthly') => void
}

function PeriodToggle({ period, onToggle }: PeriodToggleProps) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden text-sm">
      {(['daily', 'monthly'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onToggle(p)}
          className={cn(
            'px-4 py-1.5 font-medium transition-colors capitalize',
            period === p
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[108px] w-full rounded-xl" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-[260px] rounded-xl" />
        <Skeleton className="h-[260px] rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}

// ── Inner page (uses useSearchParams) ────────────────────────────────────────

function DeveloperDetailContent() {
  const rawParams = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { selectedDate, selectedMonth } = useUIStore()

  const azureId = Array.isArray(rawParams.id) ? rawParams.id[0] : (rawParams.id as string)
  const period = (searchParams.get('period') ?? 'daily') as 'daily' | 'monthly'

  // Resolve date ranges
  const date = searchParams.get('date') ?? selectedDate
  const month = searchParams.get('month') ?? selectedMonth

  const from =
    period === 'daily' ? date : format(startOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd')
  const to = period === 'daily' ? date : format(endOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd')

  // Queries
  const { data: profileRes } = useDeveloperProfile(azureId)
  const { data: overviewRes, isLoading: overviewLoading } = useDeveloperOverview(azureId, from, to)
  const [commitPage, setCommitPage] = useState(1)
  const { data: commitsRes, isLoading: commitsLoading } = useDeveloperCommits(
    azureId,
    date,
    commitPage,
  )
  const { data: projectsRes, isLoading: projectsLoading } = useDeveloperProjects(azureId, from, to)
  const { data: prEffortRes, isLoading: prEffortLoading } = useDeveloperPrEffort(azureId, from, to)

  const summaries: DailySummary[] = useMemo(() => overviewRes?.data?.items ?? [], [overviewRes])
  const paginatedCommits = commitsRes?.data
  const projects = useMemo(() => projectsRes?.data ?? [], [projectsRes])
  const prEffort = useMemo(() => prEffortRes?.data ?? [], [prEffortRes])
  const allCommits = paginatedCommits?.items ?? []

  const profile = profileRes?.data

  const stats = useMemo(
    () => (summaries.length > 0 ? aggregateStats(summaries, azureId) : undefined),
    [summaries, azureId],
  )

  const resolvedDisplayName =
    stats?.displayName ?? profile?.displayName ?? profile?.name ?? undefined

  const heatmapValues = useMemo(
    () =>
      period === 'monthly'
        ? summaries.map((s) => ({ date: s.date, count: s.totalCommits }))
        : undefined,
    [summaries, period],
  )

  // KPI values
  const avgScore = stats?.avgEfficiencyScore ?? null
  const netLines = (stats?.totalLinesAdded ?? 0) - (stats?.totalLinesRemoved ?? 0)

  // Period toggle handler
  const handlePeriodToggle = (p: 'daily' | 'monthly') => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('period', p)
    if (p === 'daily') sp.set('date', date)
    else sp.set('month', month)
    setCommitPage(1)
    router.push(`/developer/${azureId}?${sp.toString()}`)
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Developer Profile</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {period === 'daily'
              ? `Data for ${date}`
              : `Monthly view — ${new Date(Number(month.split('-')[0]), Number(month.split('-')[1]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
          </p>
        </div>
        <PeriodToggle period={period} onToggle={handlePeriodToggle} />
      </div>

      {/* ── Developer card ───────────────────────────────────────────────── */}
      <DeveloperCard
        azureId={azureId}
        displayName={resolvedDisplayName}
        stats={stats}
        isLoading={overviewLoading}
      />

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Total Commits"
          value={stats?.totalCommits ?? 0}
          icon={GitCommit}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="Net Lines"
          value={netLines >= 0 ? `+${netLines.toLocaleString()}` : netLines.toLocaleString()}
          icon={netLines >= 0 ? TrendingUp : TrendingDown}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="Avg Efficiency"
          value={avgScore != null ? `${avgScore.toFixed(1)}%` : '—'}
          icon={Gauge}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="PRs Merged"
          value={stats?.prMerged ?? 0}
          icon={GitCommit}
          isLoading={overviewLoading}
        />
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="px-5 pb-0 pt-4">
            <p className="text-sm font-semibold text-foreground">Efficiency Score</p>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <EfficiencyGauge score={avgScore} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-5 pb-0 pt-4">
            <p className="text-sm font-semibold text-foreground">Lines of Code</p>
            <p className="text-xs text-muted-foreground">Added vs removed over time</p>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <LinesOfCodeChart summaries={summaries} />
          </CardContent>
        </Card>
      </div>

      {/* ── Commit activity heatmap (monthly view only) ──────────────────── */}
      {period === 'monthly' && (
        <Card>
          <CardHeader className="px-5 pb-2 pt-4">
            <p className="text-sm font-semibold text-foreground">
              Commit Activity —{' '}
              {new Date(Number(month.split('-')[0]), Number(month.split('-')[1]) - 1, 1).toLocaleDateString(
                'en-US',
                { month: 'long', year: 'numeric' },
              )}
            </p>
            <p className="text-xs text-muted-foreground">Commits per day for this developer</p>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <CommitHeatmap
              month={month}
              commitValues={heatmapValues}
              isLoading={overviewLoading}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Project breakdown ────────────────────────────────────────────── */}
      <ProjectBreakdown projects={projects} commits={allCommits} isLoading={projectsLoading} />

      {/* ── Commit timeline ─────────────────────────────────────────────── */}
      <CommitTimeline
        result={paginatedCommits}
        page={commitPage}
        onPageChange={setCommitPage}
        isLoading={commitsLoading}
      />

      {/* ── PR work analysis (estimated vs actual, per PR) ──────────────── */}
      <PrWorkAnalysisCard azureId={azureId} prs={prEffort} isLoading={prEffortLoading} />
    </div>
  )
}

// ── Page export (Suspense boundary for useSearchParams) ───────────────────────

export default function DeveloperDetailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DeveloperDetailContent />
    </Suspense>
  )
}
