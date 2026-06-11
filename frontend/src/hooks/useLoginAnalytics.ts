import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { ApiResponse } from '@/types/api.types'

export interface DailyLoginCount {
  date: string
  totalLogins: number
  uniqueUsers: number
}

export interface LoginEventRecord {
  id: string
  userId: string
  email: string
  name: string
  role: string
  date: string
  ipAddress?: string
  loggedInAt: string
}

/**
 * Admin-only day-wise login counts. `enabled` should reflect whether the
 * current user is an admin so non-admins never trigger the request.
 */
export function useDailyLogins(enabled = true, from?: string, to?: string) {
  return useQuery({
    queryKey: ['analytics', 'logins', 'daily', from ?? '', to ?? ''] as const,
    queryFn: () =>
      api.get<ApiResponse<DailyLoginCount[]>>('/analytics/logins/daily', {
        params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Admin-only individual login events. Enable only when the details panel is open.
 */
export function useLoginEvents(enabled = true, from?: string, to?: string) {
  return useQuery({
    queryKey: ['analytics', 'logins', 'events', from ?? '', to ?? ''] as const,
    queryFn: () =>
      api.get<ApiResponse<LoginEventRecord[]>>('/analytics/logins/events', {
        params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}
