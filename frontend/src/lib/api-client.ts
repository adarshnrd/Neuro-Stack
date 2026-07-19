import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import { getAuthState } from '@/store/auth.store'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

// ── Instance ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// ── Request interceptor — attach access token ─────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const { accessToken } = getAuthState()
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`
      }
    }
    return config
  },
  (error) => Promise.reject(error),
)

// ── Response interceptor — silent token refresh on 401 ───────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error)

    const originalRequest = error.config as RetryableRequestConfig | undefined
    if (!originalRequest) return Promise.reject(error)

    const status = error.response?.status

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const { refreshToken, setTokens, clearAuth } = getAuthState()

      if (!refreshToken) {
        clearAuth()
        if (typeof window !== 'undefined') window.location.href = '/signin'
        return Promise.reject(error)
      }

      try {
        // NestJS refresh endpoint expects the refresh token as Bearer header.
        // Backend wraps all responses in ApiResponse: { success, data: {...} }
        const { data: body } = await axios.post<{
          success: boolean
          data: { accessToken: string; refreshToken: string }
        }>(
          `${BASE_URL}/api/v1/auth/refresh`,
          {},
          { headers: { Authorization: `Bearer ${refreshToken}` } },
        )

        setTokens(body.data.accessToken, body.data.refreshToken)
        originalRequest.headers.Authorization = `Bearer ${body.data.accessToken}`

        // Retry the original request with the new access token
        return apiClient(originalRequest as AxiosRequestConfig)
      } catch {
        // Refresh itself returned 401 — session is truly expired
        clearAuth()
        if (typeof window !== 'undefined') window.location.href = '/signin'
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  },
)

// ── Typed convenience wrappers ────────────────────────────────────────────────

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<T>(url, config).then((r) => r.data),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<T>(url, data, config).then((r) => r.data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<T>(url, data, config).then((r) => r.data),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, data, config).then((r) => r.data),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, config).then((r) => r.data),
}
