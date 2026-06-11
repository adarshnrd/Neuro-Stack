/**
 * Raised when an Azure DevOps API call is throttled (HTTP 429) or the service
 * is temporarily unavailable (HTTP 503) and retries within a single call have
 * been exhausted. Carries the recommended wait before the work should be
 * re-attempted so webhook processing can back off without losing the event.
 */
export class AzureRateLimitError extends Error {
  constructor(
    message: string,
    /** Suggested delay before retrying, in milliseconds. */
    readonly retryAfterMs: number,
  ) {
    super(message)
    this.name = 'AzureRateLimitError'
  }
}

export interface RateLimitInfo {
  isRateLimited: boolean
  /** Parsed from the Retry-After header when Azure provides it. */
  retryAfterMs?: number
}

/**
 * Best-effort inspection of an azure-devops-node-api error to decide whether it
 * represents a rate-limit / transient-unavailable condition, and to extract a
 * Retry-After hint. The node SDK surfaces the HTTP status as `statusCode` (and
 * occasionally `status`); the Retry-After header location varies, so several
 * shapes are probed defensively.
 */
export function parseAzureRateLimit(err: unknown): RateLimitInfo {
  if (!err || typeof err !== 'object') return { isRateLimited: false }

  const e = err as Record<string, unknown>
  const status =
    (typeof e['statusCode'] === 'number' && (e['statusCode'] as number)) ||
    (typeof e['status'] === 'number' && (e['status'] as number)) ||
    undefined

  // 429 Too Many Requests, 503 Service Unavailable
  const isRateLimited = status === 429 || status === 503
  if (!isRateLimited) return { isRateLimited: false }

  return { isRateLimited: true, retryAfterMs: extractRetryAfterMs(e) }
}

function extractRetryAfterMs(e: Record<string, unknown>): number | undefined {
  // Headers may live under responseHeaders / headers / response.headers
  const headerBags: Array<Record<string, unknown> | undefined> = [
    e['responseHeaders'] as Record<string, unknown> | undefined,
    e['headers'] as Record<string, unknown> | undefined,
    (e['response'] as Record<string, unknown> | undefined)?.['headers'] as
      | Record<string, unknown>
      | undefined,
  ]

  for (const bag of headerBags) {
    if (!bag) continue
    const raw = bag['retry-after'] ?? bag['Retry-After'] ?? bag['retryAfter']
    const ms = parseRetryAfter(raw)
    if (ms !== undefined) return ms
  }
  return undefined
}

function parseRetryAfter(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  // Numeric form = delta-seconds
  const seconds = Number(value)
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000)
  // HTTP-date form
  const date = new Date(String(value))
  if (!Number.isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now())
  return undefined
}
