'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiClient } from '@/lib/api-client'
import type { ApiResponse } from '@/types/api.types'
import type { UserRole } from '@/types/developer.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserPreferences {
  emailNotifications: boolean
  weeklyDigest: boolean
  showEfficiencyScore: boolean
  defaultPeriod: 'daily' | 'monthly'
}

export interface UserProfile {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  isWhitelisted: boolean
  azureDevOpsId?: string
  displayName?: string
  team?: string
  hasAvatar: boolean
  preferences?: UserPreferences
  lastLoginAt?: string
  createdAt?: string
}

export interface PaginatedUsers {
  items: UserProfile[]
  total: number
  page: number
  totalPages: number
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useMyProfile() {
  return useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => api.get<ApiResponse<UserProfile>>('/users/me').then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name?: string; team?: string }) =>
      api.patch<ApiResponse<UserProfile>>('/users/me', data).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData(['settings', 'profile'], updated)
    },
  })
}

export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { data: string; mimeType: string }) =>
      api.post('/users/me/avatar', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'profile'] })
    },
  })
}

export function useAvatarUrl(hasAvatar: boolean) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!hasAvatar) {
      setBlobUrl(null)
      return
    }
    let active = true
    apiClient
      .get('/users/me/avatar', { responseType: 'blob' })
      .then((r) => {
        if (!active) return
        const url = URL.createObjectURL(r.data as Blob)
        setBlobUrl(url)
      })
      .catch(() => setBlobUrl(null))
    return () => {
      active = false
    }
  }, [hasAvatar])

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return blobUrl
}

export function useDeleteAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('/users/me/avatar'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'profile'] })
    },
  })
}

export function useUpdatePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<UserPreferences>) =>
      api.patch<ApiResponse<UserProfile>>('/users/me/preferences', data).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData(['settings', 'profile'], updated)
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post('/users/change-password', data),
  })
}

export function useInvalidateSessions() {
  return useMutation({
    mutationFn: () => api.delete('/users/me/sessions'),
  })
}

export function useAllUsers(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['settings', 'users', page, limit],
    queryFn: () =>
      api
        .get<ApiResponse<PaginatedUsers>>('/users', { params: { page, limit } })
        .then((r) => r.data),
    staleTime: 30_000,
  })
}

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.patch<ApiResponse<UserProfile>>(`/users/${id}/role`, { role }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] })
    },
  })
}

export function useSetUserStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<ApiResponse<UserProfile>>(`/users/${id}/status`, { isActive }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] })
    },
  })
}

export interface DailyBuildResult {
  date: string
  upserted: number
  updated: number
}

export function useTriggerDailyAnalytics() {
  return useMutation({
    mutationFn: (date?: string) =>
      api
        .post<ApiResponse<DailyBuildResult>>(
          '/analytics/admin/trigger-daily',
          undefined,
          { params: date ? { date } : undefined },
        )
        .then((r) => r.data),
  })
}
