import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as azdev from 'azure-devops-node-api'
import { AzureThrottleService } from './azure-throttle.service'

export interface OrgAzureClient {
  webApi: azdev.WebApi
  /** Per-organization throttle bucket — each PAT has its own Azure rate budget. */
  throttle: AzureThrottleService
}

/**
 * Builds and memoizes a per-organization Azure DevOps client.
 *
 * Replaces the single global PAT/`WebApi` built from env in the Azure services:
 * each connected organization authenticates with its own stored PAT and gets an
 * isolated throttle bucket so a busy client org cannot starve another. Cached by
 * `orgUrl`; callers must {@link invalidate} after a PAT rotation or org
 * deactivation so the next call rebuilds with fresh credentials.
 */
@Injectable()
export class AzureClientFactory {
  private readonly logger = new Logger(AzureClientFactory.name)
  private readonly cache = new Map<string, OrgAzureClient>()

  constructor(private readonly configService: ConfigService) {}

  /** Get (or build) the Azure client + throttle for an org's URL + PAT. */
  getClient(orgUrl: string, pat: string): OrgAzureClient {
    const existing = this.cache.get(orgUrl)
    if (existing) return existing

    const webApi = new azdev.WebApi(orgUrl, azdev.getPersonalAccessTokenHandler(pat))
    const throttle = new AzureThrottleService(this.configService)
    const client: OrgAzureClient = { webApi, throttle }
    this.cache.set(orgUrl, client)
    return client
  }

  /** Drop a cached client (after a PAT rotation or org deactivation). */
  invalidate(orgUrl: string): void {
    this.cache.delete(orgUrl)
  }

  /**
   * Validate an orgUrl + PAT pair with a cheap authenticated call.
   * Returns false (and evicts the candidate client) on any auth/connectivity
   * failure so callers can reject an invalid credential before persisting it.
   */
  async probe(orgUrl: string, pat: string): Promise<boolean> {
    const { webApi, throttle } = this.getClient(orgUrl, pat)
    try {
      await throttle.runWithRetry(async () => {
        const core = await webApi.getCoreApi()
        await core.getProjects(undefined, 1)
      })
      return true
    } catch (err) {
      this.logger.warn(
        `Azure probe failed for ${orgUrl}: ${err instanceof Error ? err.message : String(err)}`,
      )
      this.invalidate(orgUrl)
      return false
    }
  }
}
