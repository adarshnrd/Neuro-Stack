'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  LayoutDashboard,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui.store'

const LIGHT_THEMES = new Set(['theme-light', 'theme-sepia'])

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  adminOnly?: boolean
}

// ── Nav configuration ─────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Daily Analytics', href: '/analytics/daily', icon: Calendar },
  { label: 'Monthly Analytics', href: '/analytics/monthly', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
]

// ── Avatar helpers ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-amber-500',
  'bg-rose-500',
]

function nameToColorClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'border-l-2',
        isActive
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <item.icon size={16} className="shrink-0" />
      {item.label}
    </Link>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()

  const theme = useUIStore((s) => s.theme)
  const isLightTheme = LIGHT_THEMES.has(theme)

  const role = session?.user?.role ?? 'manager'
  const displayName = session?.user?.displayName ?? session?.user?.email ?? 'User'
  const initials = getInitials(displayName)
  const avatarColor = nameToColorClass(displayName)

  const handleSignOut = async () => {
    await signOut({ redirect: false })
    router.push('/signin')
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center px-4 py-4">
        <Image
          src={isLightTheme ? '/mindpath-logo-light.webp' : '/mindpath-logo.webp'}
          alt="Mindpath logo"
          width={160}
          height={40}
          className="h-9 w-auto object-contain"
          priority
        />
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {visibleItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <Separator />

      {/* User footer */}
      <div className="px-3 py-4">
        <div className="mb-3 flex items-center gap-3">
          {/* Avatar */}
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
              avatarColor,
            )}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-none">{displayName}</p>
            <Badge
              variant="secondary"
              className="mt-1 px-1.5 py-0 text-[10px] font-medium capitalize"
            >
              {ROLE_LABEL[role] ?? role}
            </Badge>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
          )}
        >
          <LogOut size={13} className="shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
