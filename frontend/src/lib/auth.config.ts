import type { NextAuthOptions, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import CredentialsProvider from 'next-auth/providers/credentials'
import axios from 'axios'

// ── next-auth type augmentation ───────────────────────────────────────────────
// Extends the default Session, User, and JWT types to carry DevAnalytics fields.

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      role: string
      azureDevOpsId?: string
      displayName?: string
      team?: string
    }
    accessToken: string
    refreshToken: string
    error?: 'RefreshTokenExpired'
  }

  interface User {
    id: string
    email: string
    role: string
    azureDevOpsId?: string
    displayName?: string
    team?: string
    accessToken: string
    refreshToken: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    user: {
      id: string
      email: string
      role: string
      azureDevOpsId?: string
      displayName?: string
      team?: string
    }
    accessToken: string
    refreshToken: string
    error?: 'RefreshTokenExpired'
  }
}

// ── Backend URL (server-side; never exposed to the browser) ───────────────────

const BACKEND_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

// ── Auth options ──────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('MISSING_CREDENTIALS')
        }

        try {
          // Backend wraps all responses in ApiResponse: { success, data: {...}, statusCode, timestamp }
          const { data: body } = await axios.post<{
            success: boolean
            data: {
              user: {
                id: string
                email: string
                role: string
                azureDevOpsId?: string
                displayName?: string
                team?: string
              }
              accessToken: string
              refreshToken: string
            }
          }>(`${BACKEND_URL}/api/v1/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          })

          const { user, accessToken, refreshToken } = body.data

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            azureDevOpsId: user.azureDevOpsId,
            displayName: user.displayName,
            team: user.team,
            accessToken,
            refreshToken,
          } satisfies User
        } catch (err: unknown) {
          if (!axios.isAxiosError(err)) throw new Error('LOGIN_FAILED')

          const status = err.response?.status
          if (status === 401) throw new Error('INVALID_CREDENTIALS')
          if (status === 403) throw new Error('ACCOUNT_NOT_WHITELISTED')
          if (status === 423) {
            // Backend sends message like "ACCOUNT_LOCKED_UNTIL:<ISO date>" via
            // the global HttpExceptionFilter → { message, statusCode, ... }
            const msg = (err.response?.data as { message?: string })?.message ?? ''
            const isoDate = msg.startsWith('ACCOUNT_LOCKED_UNTIL:')
              ? msg.slice('ACCOUNT_LOCKED_UNTIL:'.length)
              : undefined
            throw new Error(isoDate ? `ACCOUNT_LOCKED:${isoDate}` : 'ACCOUNT_LOCKED')
          }
          throw new Error('LOGIN_FAILED')
        }
      },
    }),
  ],

  callbacks: {
    /**
     * jwt — called on sign-in and on every session read.
     * Stores the backend tokens + user profile inside the JWT.
     */
    async jwt({ token, user }): Promise<JWT> {
      // Initial sign-in: user object is populated
      if (user) {
        return {
          ...token,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            azureDevOpsId: user.azureDevOpsId,
            displayName: user.displayName,
            team: user.team,
          },
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
        }
      }
      // Subsequent reads: return the stored token as-is.
      // Token refresh is handled client-side by the axios interceptor.
      return token
    },

    /**
     * session — called whenever getServerSession() or useSession() is invoked.
     * Exposes the user profile and access token to the client.
     */
    async session({ session, token }) {
      session.user = token.user
      session.accessToken = token.accessToken
      session.refreshToken = token.refreshToken
      if (token.error) session.error = token.error
      return session
    },
  },

  pages: {
    signIn: '/signin',
    error: '/signin',
  },

  session: {
    strategy: 'jwt',
    // Max session duration — matches backend JWT expiry
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  // Prevent NextAuth from logging credentials in plaintext
  debug: process.env.NODE_ENV === 'development',

  secret: process.env.NEXTAUTH_SECRET,
}
