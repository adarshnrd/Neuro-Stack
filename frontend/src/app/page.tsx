import { redirect } from 'next/navigation'

// Root "/" redirects authenticated users to the dashboard.
// Unauthenticated users are caught by the middleware and sent to /signin first.
export default function RootPage() {
  redirect('/dashboard')
}
