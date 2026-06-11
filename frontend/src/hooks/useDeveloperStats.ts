import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { DailySummary, ProjectStats, PrEffort, PrCommit } from '@/types/analytics.types'
import type { CommitRecord } from '@/types/commit.types'
import type { ApiResponse, PaginatedResult } from '@/types/api.types'

export interface DeveloperProfile {
  id: string
  name: string
  displayName?: string
  team?: string
  role?: string
  azureDevOpsId?: string
}

export function useDeveloperProfile(azureId: string) {
  return useQuery({
    queryKey: ['developer', azureId, 'profile'] as const,
    queryFn: () => api.get<ApiResponse<DeveloperProfile>>(`/developers/${azureId}`),
    enabled: !!azureId,
    staleTime: 10 * 60 * 1000,
  })
}

export function useDeveloperOverview(azureId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['developer', azureId, 'daily', from, to] as const,
    queryFn: () =>
      api.get<ApiResponse<PaginatedResult<DailySummary>>>(`/analytics/developer/${azureId}/daily`, {
        params: { from, to, limit: 90 },
      }),
    enabled: !!azureId && !!from && !!to,
    staleTime: 3 * 60 * 1000,
  })
}

export function useDeveloperCommits(
  azureId: string,
  date: string,
  page = 1,
  repositoryId?: string,
) {
  return useQuery({
    queryKey: ['developer', azureId, 'commits', date, page, repositoryId ?? ''] as const,
    queryFn: () =>
      api.get<ApiResponse<PaginatedResult<CommitRecord>>>(
        `/analytics/developer/${azureId}/commits`,
        {
          params: {
            date,
            page,
            limit: 25,
            ...(repositoryId ? { repositoryId } : {}),
          },
        },
      ),
    enabled: !!azureId && !!date,
    staleTime: 3 * 60 * 1000,
    placeholderData: (prev) => prev,
  })
}

export function useDeveloperProjects(azureId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['developer', azureId, 'projects', from, to] as const,
    queryFn: () =>
      api.get<ApiResponse<ProjectStats[]>>(`/analytics/developer/${azureId}/projects`, {
        params: { from, to },
      }),
    enabled: !!azureId && !!from && !!to,
    staleTime: 5 * 60 * 1000,
  })
}

export function useDeveloperPrEffort(azureId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['developer', azureId, 'pr-effort', from, to] as const,
    queryFn: () =>
      api.get<ApiResponse<PrEffort[]>>(`/analytics/developer/${azureId}/pr-effort`, {
        params: { from, to },
      }),
    enabled: !!azureId && !!from && !!to,
    staleTime: 3 * 60 * 1000,
  })
}

/**
 * Full commit history for a single PR — fed lazily when a PR row is expanded,
 * so the list is only fetched for the PR the user actually opens.
 */
export function useDeveloperPrCommits(azureId: string, azurePrId: string | null) {
  return useQuery({
    queryKey: ['developer', azureId, 'pr-commits', azurePrId] as const,
    queryFn: () =>
      api.get<ApiResponse<PrCommit[]>>(`/analytics/developer/${azureId}/pr/${azurePrId}/commits`),
    enabled: !!azureId && !!azurePrId,
    staleTime: 3 * 60 * 1000,
  })
}
