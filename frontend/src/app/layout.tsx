import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Inter } from 'next/font/google'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth.config'
import { Providers } from '@/components/providers'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: {
    default: 'DevAnalytics',
    template: '%s | DevAnalytics',
  },
  description:
    'Developer productivity analytics — commits, efficiency scores, PR insights, and sprint summaries for Azure DevOps teams.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased" suppressHydrationWarning>
        {/*
         * Runs before React hydrates (beforeInteractive) to apply the persisted
         * theme class to <html> immediately — prevents flash of default theme.
         */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=JSON.parse(localStorage.getItem('da-ui')||'{}');var t=s&&s.state&&s.state.theme;if(t&&/^theme-(light|dark|dim|nord|solarized|sepia|dracula|high-contrast)$/.test(t)){document.documentElement.classList.add(t)}}catch(e){}})()",
          }}
        />
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  )
}
