import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth.config'

/**
 * App Router NextAuth handler.
 *
 * next-auth@4 is fully compatible with the App Router when the handler is
 * re-exported as GET and POST from this route file.
 */
const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
