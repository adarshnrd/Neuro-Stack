/**
 * Day/month bucketing in the organisation's reporting timezone.
 *
 * Analytics are bucketed by *local* calendar day, not UTC — otherwise activity
 * created late in the local evening lands on the previous UTC day and "today"
 * on the dashboard looks empty. Defaults to IST (+05:30); override with
 * ANALYTICS_TZ_OFFSET_MINUTES. India has no DST, so a fixed offset is correct;
 * revisit if the product ever spans multiple regions.
 */
const TZ_OFFSET_MINUTES = Number(process.env.ANALYTICS_TZ_OFFSET_MINUTES ?? 330)
const DAY_MS = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')

/** The reporting-tz calendar day an instant falls in, as 'YYYY-MM-DD'. */
export function dayKey(date: Date): string {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * 60_000)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** The reporting-tz month an instant falls in, as 'YYYY-MM'. */
export function monthKey(date: Date): string {
  return dayKey(date).slice(0, 7)
}

/**
 * UTC [start, end] instants that bound a reporting-tz day 'YYYY-MM-DD'.
 * e.g. for IST, '2026-06-11' → 2026-06-10T18:30:00Z .. 2026-06-11T18:29:59.999Z.
 */
export function dayRange(dateStr: string): { start: Date; end: Date } {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const startMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - TZ_OFFSET_MINUTES * 60_000
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS - 1) }
}

/** Reporting-tz 'today' as 'YYYY-MM-DD'. */
export function todayKey(now: Date = new Date()): string {
  return dayKey(now)
}

/** Reporting-tz 'yesterday' as 'YYYY-MM-DD'. */
export function yesterdayKey(now: Date = new Date()): string {
  return dayKey(new Date(now.getTime() - DAY_MS))
}

/** Reporting-tz current month as 'YYYY-MM'. */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now)
}

/** Reporting-tz previous month as 'YYYY-MM'. */
export function previousMonthKey(now: Date = new Date()): string {
  const [y, m] = monthKey(now).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}
