'use client'

import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ChevronRight, Palette } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUIStore, CORE_THEMES, BONUS_THEMES, type Theme, type ThemeDef } from '@/store/ui.store'
import { cn } from '@/lib/utils'

// ── Theme dropdown item ───────────────────────────────────────────────────────

function ThemeItem({
  t,
  active,
  onSelect,
}: {
  t: ThemeDef
  active: boolean
  onSelect: (v: Theme) => void
}) {
  return (
    <DropdownMenuItem
      onClick={() => onSelect(t.value)}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 py-1.5 text-sm',
        active && 'bg-accent/50',
      )}
    >
      <span className="w-4 text-center text-sm leading-none">{t.icon}</span>
      <div className="min-w-0 flex-1">
        <span className="block font-medium leading-none">{t.label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {t.description}
        </span>
      </div>
      {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
    </DropdownMenuItem>
  )
}

// ── Breadcrumb helpers ────────────────────────────────────────────────────────

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  analytics: 'Analytics',
  daily: 'Daily',
  monthly: 'Monthly',
  settings: 'Settings',
  admin: 'Admin',
}

function labelFor(segment: string): string {
  return (
    SEGMENT_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function buildCrumbs(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(labelFor)
}

// ── Picker visibility ─────────────────────────────────────────────────────────

function shouldShowDatePicker(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.includes('/daily')
}

function shouldShowMonthPicker(pathname: string): boolean {
  return pathname.includes('/monthly')
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  manager: 'secondary',
  developer: 'outline',
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  developer: 'Developer',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopHeader() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const { selectedDate, selectedMonth, setSelectedDate, setSelectedMonth, theme, setTheme } =
    useUIStore()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const crumbs = buildCrumbs(pathname)
  const role = session?.user?.role ?? 'manager'
  const showDate = shouldShowDatePicker(pathname)
  const showMonth = shouldShowMonthPicker(pathname)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await queryClient.invalidateQueries()
    // Brief visual feedback even though invalidation is synchronous
    setTimeout(() => setIsRefreshing(false), 600)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      {/* Breadcrumb */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label="Breadcrumb">
        {crumbs.length === 0 ? (
          <span className="font-medium text-foreground">Home</span>
        ) : (
          crumbs.map((label, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
              <span
                className={cn(
                  'truncate',
                  i === crumbs.length - 1
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </span>
          ))
        )}
      </nav>

      {/* Right controls */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Date picker — daily analytics & dashboard */}
        {showDate && (
          <input
            type="date"
            value={selectedDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className={cn(
              'h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground',
              'cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring',
              'transition-colors hover:border-ring',
            )}
            aria-label="Select date"
          />
        )}

        {/* Month picker — monthly analytics */}
        {showMonth && (
          <input
            type="month"
            value={selectedMonth}
            max={new Date().toISOString().slice(0, 7)}
            onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
            className={cn(
              'h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground',
              'cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring',
              'transition-colors hover:border-ring',
            )}
            aria-label="Select month"
          />
        )}

        {(showDate || showMonth) && <Separator orientation="vertical" className="mx-1 h-5" />}

        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Switch theme"
              className="h-8 w-8 p-0"
            >
              <Palette size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {/* Core themes */}
            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Core
            </DropdownMenuLabel>
            {CORE_THEMES.map((t) => (
              <ThemeItem key={t.value} t={t} active={theme === t.value} onSelect={setTheme} />
            ))}

            <DropdownMenuSeparator />

            {/* Bonus themes */}
            <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Bonus
            </DropdownMenuLabel>
            {BONUS_THEMES.map((t) => (
              <ThemeItem key={t.value} t={t} active={theme === t.value} onSelect={setTheme} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh data"
          className="h-8 w-8 p-0"
        >
          <RefreshCw size={14} className={cn(isRefreshing && 'animate-spin text-primary')} />
        </Button>

        {/* Role badge */}
        <Badge
          variant={ROLE_VARIANT[role] ?? 'outline'}
          className="h-6 px-2 text-[11px] font-medium capitalize"
        >
          {ROLE_LABEL[role] ?? role}
        </Badge>
      </div>
    </header>
  )
}
