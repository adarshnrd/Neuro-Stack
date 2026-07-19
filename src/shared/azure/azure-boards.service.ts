import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as azdev from 'azure-devops-node-api'
import type { WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces'
import type { IAzureBoardsService, AzureWorkItemData } from '../interfaces/azure-boards.interface'
import { AzureThrottleService } from './azure-throttle.service'
import { AzureRateLimitError } from './azure-rate-limit.error'

// Re-export for consumers that import directly from this file
export type WorkItemData = AzureWorkItemData

// ── Azure field reference names ─────────────────────────────────────────────

const WIT_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  'System.TeamProject',
  'System.IterationPath',
  'Microsoft.VSTS.Scheduling.OriginalEstimate',
  'Microsoft.VSTS.Scheduling.CompletedWork',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.ActivatedDate',
] as const

const MAX_BATCH = 200 // Azure DevOps hard limit per getWorkItems call

@Injectable()
export class AzureBoardsService implements IAzureBoardsService {
  private readonly logger = new Logger(AzureBoardsService.name)
  private readonly webApi: azdev.WebApi

  constructor(
    private readonly configService: ConfigService,
    private readonly throttle: AzureThrottleService,
  ) {
    const orgUrl = this.configService.getOrThrow<string>('azure.orgUrl')
    const pat = this.configService.getOrThrow<string>('azure.pat')
    this.webApi = new azdev.WebApi(orgUrl, azdev.getPersonalAccessTokenHandler(pat))
  }

  // ── Throttled retry ─────────────────────────────────────────────────────────
  // Routes every Azure call through the shared rate limiter + 429-aware retry.

  private withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return this.throttle.runWithRetry(fn)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async getWorkItem(id: number): Promise<AzureWorkItemData> {
    return this.withRetry(async () => {
      const wit = await this.webApi.getWorkItemTrackingApi()
      const item = await wit.getWorkItem(id, [...WIT_FIELDS])
      if (!item) throw new Error(`Work item ${id} returned null`)
      return this.mapWorkItem(item)
    })
    // Intentionally re-throws after all retries — callers must handle or catch
  }

  async getWorkItemsBatch(ids: number[]): Promise<AzureWorkItemData[]> {
    if (!ids.length) return []
    try {
      const results: AzureWorkItemData[] = []
      for (const chunk of this.chunks(ids, MAX_BATCH)) {
        const items = await this.withRetry(async () => {
          const wit = await this.webApi.getWorkItemTrackingApi()
          return wit.getWorkItems(chunk, [...WIT_FIELDS])
        })
        for (const item of items ?? []) {
          if (item) results.push(this.mapWorkItem(item))
        }
      }
      return results
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getWorkItemsBatch failed (${ids.length} ids)`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  /**
   * Returns the work item IDs linked to a pull request.
   * Requires repositoryId because Azure's Git API scopes PRs to a repo.
   */
  async getPrLinkedWorkItems(
    repositoryId: string,
    prId: number,
    projectName: string,
  ): Promise<number[]> {
    try {
      return await this.withRetry(async () => {
        const git = await this.webApi.getGitApi()
        const refs = await git.getPullRequestWorkItemRefs(repositoryId, prId, projectName)
        return (refs ?? []).map((r) => parseInt(r.id ?? '0', 10)).filter((n) => !isNaN(n) && n > 0)
      })
    } catch (err) {
      if (err instanceof AzureRateLimitError) throw err
      this.logger.error(
        `getPrLinkedWorkItems failed [repo=${repositoryId} pr=${prId}]`,
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private mapWorkItem(item: WorkItem): AzureWorkItemData {
    const f = (item.fields ?? {}) as Record<string, unknown>

    const iterPath = f['System.IterationPath'] as string | undefined
    const sprintName = iterPath?.split('\\').pop()

    const assignedTo = f['System.AssignedTo']
    const assignedToId =
      assignedTo && typeof assignedTo === 'object'
        ? String((assignedTo as Record<string, unknown>).id ?? '')
        : undefined

    const toDate = (v: unknown): Date | undefined => (v ? new Date(v as string) : undefined)

    const toNum = (v: unknown): number | undefined =>
      v !== undefined && v !== null ? Number(v) : undefined

    return {
      id: item.id ?? 0,
      type: (f['System.WorkItemType'] as string) ?? '',
      title: (f['System.Title'] as string) ?? '',
      state: (f['System.State'] as string) ?? '',
      assignedToId: assignedToId || undefined,
      projectName: (f['System.TeamProject'] as string) ?? '',
      estimatedHours: toNum(f['Microsoft.VSTS.Scheduling.OriginalEstimate']),
      completedHours: toNum(f['Microsoft.VSTS.Scheduling.CompletedWork']),
      remainingHours: toNum(f['Microsoft.VSTS.Scheduling.RemainingWork']),
      storyPoints: toNum(f['Microsoft.VSTS.Scheduling.StoryPoints']),
      sprintPath: iterPath,
      sprintName,
      closedAt: toDate(f['Microsoft.VSTS.Common.ClosedDate']),
      startedAt: toDate(f['Microsoft.VSTS.Common.ActivatedDate']),
      createdInAzureAt: toDate(f['System.CreatedDate']),
    }
  }

  private chunks<T>(arr: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }
}
