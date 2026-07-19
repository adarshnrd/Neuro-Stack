import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO, isValid } from 'date-fns'

// ── Tailwind class merging (required by shadcn/ui components) ─────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Date formatting ───────────────────────────────────────────────────────────

export function formatDate(
  value: string | Date | undefined | null,
  pattern = 'MMM d, yyyy',
): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? parseISO(value) : value
  return isValid(date) ? format(date, pattern) : '—'
}

export function formatDateTime(value: string | Date | undefined | null): string {
  return formatDate(value, 'MMM d, yyyy HH:mm')
}

export function formatRelativeDay(dateStr: string): string {
  const today = new Date()
  const date = parseISO(dateStr)
  if (!isValid(date)) return dateStr
  const diffDays = Math.round(
    (today.setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24),
  )
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return format(date, 'MMM d')
}

// ── Number formatting ─────────────────────────────────────────────────────────

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export function formatPercent(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—'
  return `${n.toFixed(decimals)}%`
}

// ── Efficiency score colour ───────────────────────────────────────────────────

export function scoreColour(score: number | null): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 80) return 'text-green-600 dark:text-green-400'
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

export function scoreBadgeVariant(score: number | null): 'default' | 'secondary' | 'destructive' {
  if (score == null) return 'secondary'
  if (score >= 80) return 'default'
  if (score >= 60) return 'secondary'
  return 'destructive'
}
