/**
 * Get date that is N hours in the past
 */
export function getPastDateByHours(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Get date that is N days in the past
 */
export function getPastDateByDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Get date that is N hours in the future
 */
export function getFutureDateByHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Check if a date is older than N days
 */
export function isOlderThanDays(date: Date, days: number): boolean {
  return date.getTime() < getPastDateByDays(days).getTime();
}
