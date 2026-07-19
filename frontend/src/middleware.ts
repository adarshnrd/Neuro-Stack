import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { NextRequestWithAuth } from 'next-auth/middleware'

/**
 * withAuth wraps every matched request.
 * The `authorized` callback returns false for unauthenticated users →
 * next-auth redirects them to `pages.signIn`.
 *
 * The optional middleware function runs AFTER authorization succeeds, so
 * role-based path checks can go here without touching the public-route logic.
 */
export default withAuth(
  function middleware(req: NextRequestWithAuth) {
    const { token } = req.nextauth
    const { pathname } = req.nextUrl

    // ── Role-based access ───────────────────────────────────────────────────
    // Portal is admin/manager only; both roles may access all current routes.
    // Unauthenticated requests are redirected by the `authorized` callback.
    void token
    void pathname

    return NextResponse.next()
  },
  {
    callbacks: {
      // Return false to trigger a redirect to signIn page
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/signin',
    },
  },
)

/**
 * Matcher — run middleware on every route EXCEPT:
 *   • /signin and /signup (public auth pages)
 *   • /api/auth/* (next-auth internal routes)
 *   • Next.js static files and image optimisation
 *   • Root path handled separately (redirects to /dashboard when authed)
 */
export const config = {
  matcher: ['/((?!signin|signup|api/auth|_next/static|_next/image|favicon\\.ico).*)'],
}
