'use client'

import { useState, useEffect } from 'react'
import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useAuthStore } from '@/store/auth.store'
import { ThemeProvider } from '@/components/ThemeProvider'

// ── React Query default config ────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}

// Keep one QueryClient instance on the client so it doesn't re-create on
// every render. On the server a fresh instance is used per request.
let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient()
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

// ── Session → Zustand sync ────────────────────────────────────────────────────

function AuthSync({ session }: { session: Session | null }) {
  const { setAuth, clearAuth, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (session?.user && session.accessToken) {
      setAuth(
        {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role as 'admin' | 'manager',
          azureDevOpsId: session.user.azureDevOpsId,
          displayName: session.user.displayName,
          team: session.user.team,
          isWhitelisted: true,
        },
        session.accessToken,
        session.refreshToken,
      )
    } else if (!session && isAuthenticated) {
      // Next-auth session ended but Zustand store still thinks we're logged in
      clearAuth()
    }
  }, [session, setAuth, clearAuth, isAuthenticated])

  return null
}

// ── Providers component ───────────────────────────────────────────────────────

interface ProvidersProps {
  children: React.ReactNode
  session: Session | null
}

export function Providers({ children, session }: ProvidersProps) {
  // useState ensures the QueryClient is stable across re-renders on the client
  const [queryClient] = useState(() => getQueryClient())

  return (
    <SessionProvider session={session} refetchInterval={0}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider />
        <AuthSync session={session} />
        {children}
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  )
}
