import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
import { Model } from 'mongoose'
import { WorkItem, WorkItemDocument, WorkItemType } from '@app/database/schemas/work-item.schema'
import { PullRequest, PullRequestDocument } from '@app/database/schemas/pull-request.schema'
import { WebhookEventStatus } from '@app/database/schemas/webhook-event.schema'
import {
  AZURE_BOARDS_SERVICE,
  AzureWorkItemData,
  IAzureBoardsService,
} from '@app/shared/interfaces/azure-boards.interface'
import { AzureRateLimitError } from '@app/shared/azure/azure-rate-limit.error'
import { DevelopersService } from '@app/modules/developers/developers.service'
import { WebhooksService } from '../webhooks.service'

interface WorkItemEventPayload {
  webhookEventId: string
}

interface AzureAssignedTo {
  id?: string
  displayName?: string
  uniqueName?: string
}

// Raw fields from Azure DevOps webhook revision payload
interface AzureWorkItemFields {
  'System.Title'?: string
  'System.Description'?: string
  'System.WorkItemType'?: string
  'System.State'?: string
  'System.AssignedTo'?: AzureAssignedTo | string
  'System.TeamProject'?: string
  'System.IterationPath'?: string
  'System.CreatedDate'?: string
  'Microsoft.VSTS.Scheduling.StoryPoints'?: number
  'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number
  'Microsoft.VSTS.Scheduling.CompletedWork'?: number
  'Microsoft.VSTS.Scheduling.RemainingWork'?: number
  'Microsoft.VSTS.Common.ClosedDate'?: string
  'Microsoft.VSTS.Common.ActivatedDate'?: string
}

// A single relation entry inside resource.relations.added / resource._links
interface AzureRelation {
  rel?: string
  url?: string
  attributes?: { name?: string; comment?: string }
}

const WORK_ITEM_TYPE_MAP: Record<string, WorkItemType> = {
  Task: WorkItemType.TASK,
  Bug: WorkItemType.BUG,
  'User Story': WorkItemType.STORY,
  Feature: WorkItemType.FEATURE,
  Epic: WorkItemType.EPIC,
}

const DONE_STATES = new Set(['Done', 'Closed', 'Resolved'])

const MS_PER_DAY = 86_400_000

function mapWorkItemType(azureType: string): WorkItemType {
  return WORK_ITEM_TYPE_MAP[azureType] ?? WorkItemType.TASK
}

function extractAssignedToId(
  assignedTo: AzureWorkItemFields['System.AssignedTo'],
): string | undefined {
  if (!assignedTo) return undefined
  if (typeof assignedTo === 'string') return undefined
  return assignedTo.id
}

/** Full assignee identity (id/displayName/uniqueName) when sent as an object. */
function extractAssignedTo(
  assignedTo: AzureWorkItemFields['System.AssignedTo'],
): AzureAssignedTo | null {
  if (!assignedTo || typeof assignedTo === 'string') return null
  return assignedTo
}

/** Returns true when a relation entry represents a linked Pull Request. */
function isPrRelation(rel: AzureRelation): boolean {
  // Azure uses rel="ArtifactLink" with attribute name="Pull Request"
  // for both vstfs:// and dev.azure.com PR artifact URLs
  return (
    rel.rel === 'ArtifactLink' &&
    rel.attributes?.name?.toLowerCase().includes('pull request') === true
  )
}

/**
 * Extract the Azure pull-request id from a PR artifact relation URL.
 *
 * Azure encodes it as:
 *   vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{pullRequestId}
 * so after decoding the id is the trailing numeric path segment.
 */
function extractPrIdFromRelation(rel: AzureRelation): string | null {
  if (!isPrRelation(rel) || !rel.url) return null
  const decoded = decodeURIComponent(rel.url)
  const segments = decoded.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  return last && /^\d+$/.test(last) ? last : null
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(Math.abs(to.getTime() - from.getTime()) / MS_PER_DAY)
}

/** Azure stores System.Description as HTML — flatten to trimmed plain text. */
function stripHtml(html?: string): string | undefined {
  if (!html) return undefined
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

@Injectable()
export class WorkItemProcessor {
  private readonly logger = new Logger(WorkItemProcessor.name)

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly eventEmitter: EventEmitter2,
    private readonly developersService: DevelopersService,
    @InjectModel(WorkItem.name)
    private readonly workItemModel: Model<WorkItemDocument>,
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @Optional()
    @Inject(AZURE_BOARDS_SERVICE)
    private readonly boardsService?: IAzureBoardsService,
  ) {}

  // ── workitem.created ────────────────────────────────────────────────────────

  @OnEvent('webhook.workitem.created', { async: true })
  async handleCreated(payload: WorkItemEventPayload): Promise<void> {
    await this.processWorkItemEvent(payload, 'created')
  }

  // ── workitem.updated ────────────────────────────────────────────────────────

  @OnEvent('webhook.workitem.updated', { async: true })
  async handleUpdated(payload: WorkItemEventPayload): Promise<void> {
    await this.processWorkItemEvent(payload, 'updated')
  }

  // ── Shared processor ────────────────────────────────────────────────────────

  private async processWorkItemEvent(
    payload: WorkItemEventPayload,
    trigger: 'created' | 'updated',
  ): Promise<void> {
    const { webhookEventId } = payload
    this.logger.debug(`Work item ${trigger} event: ${webhookEventId}`)

    try {
      const { payload: raw } = await this.webhooksService.loadAndDecryptPayload(webhookEventId)
      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSING)

      // ── Extract work item ID ────────────────────────────────────────────────
      const resource = raw.resource as Record<string, unknown>
      const revision = resource.revision as
        | { id?: number; fields?: AzureWorkItemFields }
        | undefined
      const workItemId: number = (revision?.id ?? resource.id) as number

      if (!workItemId) {
        this.logger.warn(`No workItemId in payload for event ${webhookEventId}`)
        await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSED)
        return
      }

      // ── Detect PR relation links added in this event ────────────────────────
      const relationsBlock = resource.relations as { added?: AzureRelation[] } | undefined
      const addedRelations = relationsBlock?.added ?? []
      const prJustLinked = addedRelations.some(isPrRelation)
      // Azure PR ids this work item was just linked to (for reciprocal linkage).
      const linkedAzurePrIds = [
        ...new Set(addedRelations.map(extractPrIdFromRelation).filter((x): x is string => !!x)),
      ]

      // ── Fetch full work item data ───────────────────────────────────────────
      let data: AzureWorkItemData

      if (this.boardsService) {
        data = await this.boardsService.getWorkItem(workItemId)
      } else {
        const fields = revision?.fields ?? {}
        const iterationPath = fields['System.IterationPath']

        data = {
          id: workItemId,
          type: fields['System.WorkItemType'] ?? 'Task',
          title: fields['System.Title'] ?? '',
          description: stripHtml(fields['System.Description']),
          state: fields['System.State'] ?? '',
          assignedToId: extractAssignedToId(fields['System.AssignedTo']),
          projectName: fields['System.TeamProject'] ?? '',
          estimatedHours: fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],
          completedHours: fields['Microsoft.VSTS.Scheduling.CompletedWork'],
          remainingHours: fields['Microsoft.VSTS.Scheduling.RemainingWork'],
          storyPoints: fields['Microsoft.VSTS.Scheduling.StoryPoints'],
          sprintPath: iterationPath,
          sprintName: iterationPath?.split('\\').pop(),
          closedAt: fields['Microsoft.VSTS.Common.ClosedDate']
            ? new Date(fields['Microsoft.VSTS.Common.ClosedDate'])
            : undefined,
          startedAt: fields['Microsoft.VSTS.Common.ActivatedDate']
            ? new Date(fields['Microsoft.VSTS.Common.ActivatedDate'])
            : undefined,
          createdInAzureAt: fields['System.CreatedDate']
            ? new Date(fields['System.CreatedDate'])
            : undefined,
        }
      }

      // ── Auto-create developer from the assignee (real Azure GUID) ───────────
      // The raw payload carries the assignee's display name / unique name even
      // when we fetched the canonical work item from the Boards API, so prefer it
      // for enrichment. Non-fatal: a developer hiccup must not drop the work item.
      const assignee = extractAssignedTo(revision?.fields?.['System.AssignedTo'])
      const assigneeId = assignee?.id ?? data.assignedToId
      if (assigneeId) {
        try {
          await this.developersService.findOrCreateFromAzureIdentity(
            assigneeId,
            assignee?.displayName,
            assignee?.uniqueName,
          )
        } catch (devErr) {
          this.logger.warn(
            `Developer auto-create from work item #${workItemId} failed: ${String(devErr)}`,
          )
        }
      }

      // ── Build patch ─────────────────────────────────────────────────────────
      const patch: Partial<WorkItemDocument> = {
        type: mapWorkItemType(data.type),
        title: data.title,
        state: data.state,
        projectName: data.projectName,
      }

      if (data.description !== undefined) patch.description = data.description
      if (data.assignedToId !== undefined) patch.assignedToAzureId = data.assignedToId
      if (data.estimatedHours !== undefined) patch.estimatedHours = data.estimatedHours
      if (data.completedHours !== undefined) patch.completedHours = data.completedHours
      if (data.remainingHours !== undefined) patch.remainingHours = data.remainingHours
      if (data.storyPoints !== undefined) patch.storyPoints = data.storyPoints
      if (data.sprintName !== undefined) patch.sprintName = data.sprintName
      if (data.sprintPath !== undefined) patch.sprintPath = data.sprintPath
      if (data.closedAt !== undefined) patch.closedAt = data.closedAt
      if (data.startedAt !== undefined) patch.startedAt = data.startedAt
      if (data.createdInAzureAt !== undefined) patch.createdInAzureAt = data.createdInAzureAt

      // ── Record prLinkedAt only on first PR link (don't overwrite) ──────────
      // IMPORTANT: keep `prLinkedAt` OUT of `patch`. The update below sets it via
      // `$min` (earliest-wins). Putting it in `$set` too makes MongoDB reject the
      // write with "Updating the path 'prLinkedAt' would create a conflict".
      if (prJustLinked) {
        this.logger.log(`PR linked to work item #${workItemId}`)
      }

      // ── Resolve linked PRs and compute time metrics when item closes ────────
      if (DONE_STATES.has(data.state)) {
        const linkedPrs = await this.pullRequestModel
          .find({ workItemIds: workItemId }, { azurePrId: 1 })
          .exec()

        patch.linkedPrIds = linkedPrs
          .map((pr) => parseInt(pr.azurePrId, 10))
          .filter((n) => !isNaN(n))

        const closedAt = data.closedAt ?? new Date()

        // Cycle time: activated → closed (time the developer was actively working)
        if (data.startedAt) {
          patch.cycleTimeDays = daysBetween(data.startedAt, closedAt)
        }

        // Lead time: created → closed (total elapsed calendar time)
        if (data.createdInAzureAt) {
          patch.leadTimeDays = daysBetween(data.createdInAzureAt, closedAt)
        }

        this.logger.log(
          `Work item #${workItemId} closed — ` +
            `cycle: ${patch.cycleTimeDays ?? '?'}d, lead: ${patch.leadTimeDays ?? '?'}d`,
        )
      }

      await this.workItemModel
        .updateOne(
          { azureWorkItemId: workItemId },
          prJustLinked
            ? { $set: patch, $min: { prLinkedAt: new Date() } } // $min keeps the earliest date
            : { $set: patch },
          { upsert: true },
        )
        .exec()

      // ── Reciprocal linkage: write this work item onto the linked PR(s) ──────
      // CRITICAL: Azure's PR webhook payload usually has an EMPTY workItemRefs,
      // so the PR→workItem link only exists on the work-item side. Without this,
      // PullRequest.workItemIds stays empty, the PR-effort phase never leaves
      // "estimate_only", actual hours are never computed, and the PR shows up as
      // a false "missing work items" alert. We mirror the link here, then nudge
      // the PR-effort pipeline so it recomputes with the work item present.
      for (const azurePrId of linkedAzurePrIds) {
        try {
          const res = await this.pullRequestModel
            .updateOne({ azurePrId }, { $addToSet: { workItemIds: workItemId } })
            .exec()
          if (res.matchedCount > 0) {
            this.logger.log(`Linked work item #${workItemId} → PR #${azurePrId}`)
            this.eventEmitter.emit('analysis.pr.changed', { azurePrId })
          }
        } catch (linkErr) {
          this.logger.warn(
            `Failed to mirror work item #${workItemId} onto PR #${azurePrId}: ${String(linkErr)}`,
          )
        }
      }

      // Signal the PR-effort pipeline to (re)compute actual effort for any PRs
      // linked to this work item — covers the late-binding case where the work
      // item is tagged to the PR after the PR was created.
      this.eventEmitter.emit('analysis.workitem.changed', { workItemId })

      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSED)
      this.logger.debug(`Work item ${trigger} processed: #${workItemId} → state="${data.state}"`)
    } catch (err) {
      if (err instanceof AzureRateLimitError) {
        this.logger.warn(
          `Work item event ${webhookEventId} deferred — Azure rate limited (retry in ${err.retryAfterMs} ms)`,
        )
        await this.webhooksService.markRateLimited(webhookEventId, err.retryAfterMs)
        return
      }
      this.logger.error(
        `Work item ${trigger} failed: ${webhookEventId}`,
        err instanceof Error ? err.stack : String(err),
      )
      await this.webhooksService.updateStatus(
        webhookEventId,
        WebhookEventStatus.FAILED,
        err instanceof Error ? err.message : String(err),
      )
      await this.webhooksService.incrementRetryCount(webhookEventId)
    }
  }
}
