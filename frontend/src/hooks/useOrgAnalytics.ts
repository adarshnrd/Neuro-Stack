import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type {
  OrgOverview,
  DailySummary,
  MonthlySummary,
  PrAlert,
  OrgDailyEffort,
} from '@/types/analytics.types'
import type { ApiResponse } from '@/types/api.types'

// How often the "today" view re-polls for live updates. Daily summaries are
// written near-real-time by the backend projector; the current day is the only
// one that keeps changing, so historical dates are not polled.
const LIVE_POLL_MS = 20_000

/** Local-timezone today as YYYY-MM-DD (matches how selectedDate is seeded). */
function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function useOrgOverview(date: string) {
  return useQuery({
    queryKey: ['org', 'overview', date] as const,
    queryFn: () =>
      api.get<ApiResponse<OrgOverview>>('/analytics/org/overview', { params: { date } }),
    enabled: !!date,
    staleTime: 3 * 60 * 1000,
  })
}

export function useOrgDaily(date: string) {
  // Live-poll only the current day — past days are effectively static, so
  // there's no point re-fetching them on an interval.
  const isLive = date === todayStr()
  return useQuery({
    queryKey: ['org', 'daily', date] as const,
    queryFn: () =>
      api.get<ApiResponse<DailySummary[]>>('/analytics/org/daily', { params: { date } }),
    enabled: !!date,
    staleTime: isLive ? 10_000 : 3 * 60 * 1000,
    refetchInterval: isLive ? LIVE_POLL_MS : false,
    refetchIntervalInBackground: false, // don't poll a hidden tab
    refetchOnReconnect: true,
    refetchOnWindowFocus: isLive,
  })
}

export function useOrgPrEffort(date: string) {
  const isLive = date === todayStr()
  return useQuery({
    queryKey: ['org', 'pr-effort', date] as const,
    queryFn: () =>
      api.get<ApiResponse<OrgDailyEffort[]>>('/analytics/org/pr-effort', { params: { date } }),
    enabled: !!date,
    staleTime: isLive ? 10_000 : 3 * 60 * 1000,
    refetchInterval: isLive ? LIVE_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: isLive,
  })
}

export function useOrgMonthly(month: string) {
  return useQuery({
    queryKey: ['org', 'monthly', month] as const,
    queryFn: () =>
      api.get<ApiResponse<MonthlySummary[]>>('/analytics/org/monthly', { params: { month } }),
    enabled: !!month,
    staleTime: 5 * 60 * 1000,
  })
}

// Shape returned by useMonthDailyData
export type DayEntry = {
  date: string
  summaries: DailySummary[]
}

export function useMonthDailyData(month: string) {
  return useQuery({
    queryKey: ['org', 'month-daily', month] as const,
    queryFn: async (): Promise<DayEntry[]> => {
      const [year, mm] = month.split('-').map(Number)
      const today = new Date()
      const daysInMonth = new Date(year, mm, 0).getDate()

      const dates: string[] = []
      for (let day = 1; day <= daysInMonth; day++) {
        if (new Date(year, mm - 1, day) > today) break
        dates.push(`${month}-${String(day).padStart(2, '0')}`)
      }

      const results = await Promise.allSettled(
        dates.map((date) =>
          api.get<ApiResponse<DailySummary[]>>('/analytics/org/daily', { params: { date } }),
        ),
      )

      return dates.map((date, i) => ({
        date,
        summaries: results[i].status === 'fulfilled' ? (results[i].value.data ?? []) : [],
      }))
    },
    enabled: !!month,
    staleTime: 5 * 60 * 1000,
  })
}

// Result of an on-demand monthly roll-up (POST /analytics/admin/trigger-monthly)
export interface MonthlyBuildResult {
  month: string
  upserted: number
  updated: number
}

/**
 * Triggers the monthly summary roll-up for a given month, then refreshes the
 * monthly table + daily chart caches so the UI reflects the new data live.
 */
export function useTriggerMonthlySync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (month: string) =>
      api
        .post<ApiResponse<MonthlyBuildResult>>(
          '/analytics/admin/trigger-monthly',
          undefined,
          { params: { month } },
        )
        .then((r) => r.data),
    onSuccess: (_result, month) => {
      void queryClient.invalidateQueries({ queryKey: ['org', 'monthly', month] })
      void queryClient.invalidateQueries({ queryKey: ['org', 'month-daily', month] })
    },
  })
}

// Result of an on-demand daily rebuild (POST /analytics/admin/trigger-daily)
export interface DailyRebuildResult {
  date: string
  developers: number
}

/**
 * Rebuilds the daily summaries for a given day, then refreshes the daily table
 * + overview caches so the UI reflects the new data immediately.
 */
export function useTriggerDailySync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (date: string) =>
      api
        .post<ApiResponse<DailyRebuildResult>>('/analytics/admin/trigger-daily', undefined, {
          params: { date },
        })
        .then((r) => r.data),
    onSuccess: (_result, date) => {
      void queryClient.invalidateQueries({ queryKey: ['org', 'daily', date] })
      void queryClient.invalidateQueries({ queryKey: ['org', 'pr-effort', date] })
      void queryClient.invalidateQueries({ queryKey: ['org', 'overview', date] })
    },
  })
}

export function usePrAlerts(enabled = true) {
  return useQuery({
    queryKey: ['prs', 'alerts'] as const,
    queryFn: () => api.get<ApiResponse<PrAlert[]>>('/analytics/prs/alerts'),
    enabled,
    staleTime: 2 * 60 * 1000,
  })
}
