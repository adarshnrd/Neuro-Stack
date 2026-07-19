import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AzureRateLimitError, parseAzureRateLimit } from './azure-rate-limit.error'

/**
 * In-process throttle for all outbound Azure DevOps API traffic.
 *
 * Combines three protections so a burst of webhook events cannot exceed Azure's
 * rate limits or open unbounded concurrent connections:
 *   1. Bounded concurrency — at most `maxConcurrent` calls in flight.
 *   2. Rate pacing — call starts are spaced by `minIntervalMs` (a token bucket
 *      refilling at `ratePerSec`).
 *   3. Global cooldown — when Azure returns 429/503 with a Retry-After, every
 *      queued call waits out the window rather than hammering the API.
 *
 * `runWithRetry` additionally retries transient failures with jittered
 * exponential backoff and surfaces an {@link AzureRateLimitError} when a
 * rate-limit condition outlives the retry budget, so callers can requeue the
 * work instead of dropping it.
 */
@Injectable()
export class AzureThrottleService {
  private readonly logger = new Logger(AzureThrottleService.name)

  private readonly maxConcurrent: number
  private readonly minIntervalMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number

  private inFlight = 0
  private lastStartAt = 0
  private pausedUntil = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly configService: ConfigService) {
    this.maxConcurrent = this.configService.get<number>('azure.maxConcurrent') ?? 4
    const ratePerSec = this.configService.get<number>('azure.ratePerSec') ?? 5
    this.minIntervalMs = Math.ceil(1000 / Math.max(1, ratePerSec))
    this.maxRetries = this.configService.get<number>('azure.maxRetries') ?? 3
    this.baseBackoffMs = this.configService.get<number>('azure.baseBackoffMs') ?? 1000
  }

  /** Run a single Azure call under concurrency + rate limits (no retry). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /**
   * Run an Azure call with rate limiting + retry. Retries transient errors with
   * jittered backoff; on a 429/503 it honours Retry-After and pauses the whole
   * throttle. Throws {@link AzureRateLimitError} if rate-limited beyond the
   * retry budget, or the original error for other persistent failures.
   */
  async runWithRetry<T>(fn: () => Promise<T>, retries = this.maxRetries): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.run(fn)
      } catch (err) {
        lastErr = err
        const rl = parseAzureRateLimit(err)

        if (rl.isRateLimited) {
          const waitMs = rl.retryAfterMs ?? this.backoff(attempt)
          this.notifyRateLimited(waitMs)
          if (attempt < retries) {
            await sleep(waitMs)
            continue
          }
          throw new AzureRateLimitError(
            `Azure API rate limit exceeded after ${retries + 1} attempts`,
            waitMs,
          )
        }

        if (attempt < retries) {
          await sleep(this.backoff(attempt))
          continue
        }
      }
    }
    throw lastErr
  }

  /** Pause all queued/new calls for at least `ms` (e.g. on an external 429). */
  notifyRateLimited(ms: number): void {
    const until = Date.now() + ms
    if (until > this.pausedUntil) {
      this.pausedUntil = until
      this.logger.warn(`Azure rate limit hit — pausing outbound calls for ${ms} ms`)
    }
  }

  // ── Internal limiter ────────────────────────────────────────────────────────

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
      this.pump()
    })
  }

  private release(): void {
    this.inFlight--
    this.pump()
  }

  private pump(): void {
    while (this.inFlight < this.maxConcurrent && this.waiters.length > 0) {
      const now = Date.now()
      const startAt = Math.max(now, this.lastStartAt + this.minIntervalMs, this.pausedUntil)
      this.lastStartAt = startAt
      this.inFlight++
      const next = this.waiters.shift()!
      const delay = startAt - now
      if (delay <= 0) next()
      else setTimeout(next, delay)
    }
  }

  private backoff(attempt: number): number {
    const exp = this.baseBackoffMs * 2 ** attempt
    const jitter = Math.random() * this.baseBackoffMs
    return Math.round(exp + jitter)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
