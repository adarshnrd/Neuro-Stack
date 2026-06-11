'use client'

import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { GitCommit, Users, TrendingUp, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/store/ui.store'
import { formatNumber } from '@/lib/utils'
import { useOrgOverview, useOrgDaily, usePrAlerts } from '@/hooks/useOrgAnalytics'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed'
import { MissingWorkItemsAlert } from '@/components/dashboard/MissingWorkItemsAlert'
import { TopDevelopersList } from '@/components/dashboard/TopDevelopersList'

// TeamComparisonChart uses ApexCharts which accesses the DOM — load client-only.
const TeamComparisonChart = dynamic<{ data: import('@/types/analytics.types').DailySummary[] }>(
  () => import('@/components/charts/TeamComparisonChart').then((m) => m.TeamComparisonChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[320px] w-full rounded-md" />,
  },
)

// 'use client' pages can't export metadata — title comes from root layout template.
export default function DashboardPage() {
  const { data: session } = useSession()
  const { selectedDate } = useUIStore()
  const role = session?.user?.role ?? 'manager'

  const { data: overviewRes, isLoading: overviewLoading } = useOrgOverview(selectedDate)
  const { data: dailyRes, isLoading: dailyLoading } = useOrgDaily(selectedDate)

  const overview = overviewRes?.data
  const daily = dailyRes?.data ?? []

  // PR alerts are admin/manager only and only fetched when there are actually missing items.
  const canSeePrAlerts = role === 'admin' || role === 'manager'
  const missingCount = overview?.missingWorkItemPrCount ?? 0
  const { data: alertsRes, isLoading: alertsLoading } = usePrAlerts(
    canSeePrAlerts && missingCount > 0,
  )
  const prs = alertsRes?.data

  return (
    <div className="space-y-6">
      {/* ── KPI Row ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Commits Today"
          value={overview ? formatNumber(overview.totalCommitsToday) : '—'}
          icon={GitCommit}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="Active Developers"
          value={overview ? overview.activeDevelopersToday : '—'}
          icon={Users}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="Lines Added"
          value={overview ? formatNumber(overview.totalLinesAddedToday) : '—'}
          icon={TrendingUp}
          isLoading={overviewLoading}
        />
        <KpiCard
          label="Avg Efficiency"
          value={
            overview?.orgAvgEfficiencyScore != null
              ? overview.orgAvgEfficiencyScore.toFixed(1)
              : '—'
          }
          suffix={overview?.orgAvgEfficiencyScore != null ? '%' : undefined}
          icon={Zap}
          isLoading={overviewLoading}
        />
      </div>

      {/* ── Team Comparison Chart ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <p className="text-sm font-semibold text-foreground">Team Activity — Lines Changed</p>
          <p className="text-xs text-muted-foreground">
            Click a bar to open that developer&apos;s profile
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {dailyLoading ? (
            <Skeleton className="h-[320px] w-full rounded-md" />
          ) : (
            <TeamComparisonChart data={daily} />
          )}
        </CardContent>
      </Card>

      {/* ── Bottom Row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4">
        {/* Activity feed — 60% */}
        <div className="col-span-3">
          <RecentActivityFeed items={overview?.topPerformers ?? []} isLoading={overviewLoading} />
        </div>

        {/* Right panel — 40% */}
        <div className="col-span-2 space-y-4">
          <TopDevelopersList
            performers={overview?.topPerformers ?? []}
            isLoading={overviewLoading}
          />
          {canSeePrAlerts && (
            <MissingWorkItemsAlert
              count={missingCount}
              prs={prs}
              isLoading={alertsLoading && missingCount > 0}
            />
          )}
        </div>
      </div>
    </div>
  )
}
