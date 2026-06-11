import { registerAs } from '@nestjs/config'

export default registerAs('azure', () => ({
  orgUrl: process.env.AZURE_ORG_URL,
  pat: process.env.AZURE_PAT,
  // ── Outbound API rate-limit controls (consumed by AzureThrottleService) ────
  // Max concurrent in-flight Azure API calls.
  maxConcurrent: numberFromEnv(process.env.AZURE_MAX_CONCURRENT, 4),
  // Target sustained request rate (calls/second) — paces call starts.
  ratePerSec: numberFromEnv(process.env.AZURE_RATE_PER_SEC, 5),
  // In-call retry budget for transient/429 errors.
  maxRetries: numberFromEnv(process.env.AZURE_MAX_RETRIES, 3),
  // Base for jittered exponential backoff, in milliseconds.
  baseBackoffMs: numberFromEnv(process.env.AZURE_BASE_BACKOFF_MS, 1000),
}))

function numberFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return value !== undefined && !Number.isNaN(n) ? n : fallback
}
