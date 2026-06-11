function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toMonthString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function getStartOfDay(d: Date): Date {
  const result = new Date(d)
  result.setHours(0, 0, 0, 0)
  return result
}

export function getEndOfDay(d: Date): Date {
  const result = new Date(d)
  result.setHours(23, 59, 59, 999)
  return result
}

export function getPreviousDay(d: Date): Date {
  const result = new Date(d)
  result.setDate(result.getDate() - 1)
  return result
}
