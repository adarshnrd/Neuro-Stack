import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { DeveloperProfile } from '@/types/developer.types'

// ── State + actions ───────────────────────────────────────────────────────────

interface AuthState {
  user: DeveloperProfile | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
}

interface AuthActions {
  /** Full login — sets user + both tokens. */
  setAuth: (user: DeveloperProfile, accessToken: string, refreshToken: string) => void
  /** Token-only update after a silent refresh (user profile unchanged). */
  setTokens: (accessToken: string, refreshToken: string) => void
  /** Clear all auth state (logout / session expired). */
  clearAuth: () => void
}

const INITIAL: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
}

// ── SSR-safe localStorage wrapper ─────────────────────────────────────────────
// Zustand's persist middleware runs on the server during SSR; guard every
// localStorage access so it no-ops when window is undefined.

const ssrSafeStorage = createJSONStorage(() => {
  if (typeof window === 'undefined') {
    // No-op storage for SSR — state is never persisted server-side
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    } as unknown as Storage
  }
  return localStorage
})

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    (set) => ({
      ...INITIAL,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),

      clearAuth: () => set(INITIAL),
    }),
    {
      name: 'dev-analytics-auth',
      storage: ssrSafeStorage,
      // Never persist sensitive fields — only the minimum needed to restore session
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)

// ── Helpers for use outside React (e.g. axios interceptors) ──────────────────

export const getAuthState = () => useAuthStore.getState()
