import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
import { Model } from 'mongoose'
import {
  PullRequest,
  PullRequestDocument,
  PullRequestStatus,
} from '@app/database/schemas/pull-request.schema'
import { PrAlert, PrAlertDocument, PrAlertType } from '@app/database/schemas/pr-alert.schema'
import { WebhookEventStatus, WebhookEventType } from '@app/database/schemas/webhook-event.schema'
import { AzureRateLimitError } from '@app/shared/azure/azure-rate-limit.error'
import { AZURE_GIT_SERVICE, IAzureGitService } from '@app/shared/interfaces/azure-git.interface'
import { DevelopersService } from '@app/modules/developers/developers.service'
import { WebhooksService } from '../webhooks.service'
import { CommitsService } from '../services/commits.service'

interface PrEventPayload {
  webhookEventId: string
}

// Azure DevOps PR resource shape (common across created/updated/merged/abandoned)
interface AzurePrResource {
  pullRequestId: number
  title: string
  description?: string
  status: 'active' | 'completed' | 'abandoned'
  isDraft?: boolean
  repository: { id: string; name: string; project: { id: string; name: string } }
  createdBy: { id: string; displayName: string; uniqueName?: string }
  sourceRefName: string
  targetRefName: string
  reviewers?: Array<{ id: string; displayName: string; vote: number }>
  commits?: Array<{ commitId: string }>
  workItemRefs?: Array<{ id: string | number }>
  closedDate?: string
}

// Map our internal event type → PullRequestStatus
const EVENT_STATUS_MAP: Partial<Record<WebhookEventType, PullRequestStatus>> = {
  [WebhookEventType.PR_CREATED]: PullRequestStatus.ACTIVE,
  [WebhookEventType.PR_UPDATED]: PullRequestStatus.ACTIVE,
  [WebhookEventType.PR_MERGED]: PullRequestStatus.COMPLETED,
  [WebhookEventType.PR_ABANDONED]: PullRequestStatus.ABANDONED,
}

@Injectable()
export class PullRequestProcessor {
  private readonly logger = new Logger(PullRequestProcessor.name)

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly commitsService: CommitsService,
    private readonly developersService: DevelopersService,
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @InjectModel(PrAlert.name)
    private readonly prAlertModel: Model<PrAlertDocument>,
    @Optional()
    @Inject(AZURE_GIT_SERVICE)
    private readonly azureGitService?: IAzureGitService,
  ) {}

  @OnEvent('webhook.pr.*', { async: true })
  async handle(payload: PrEventPayload): Promise<void> {
    const { webhookEventId } = payload
    this.logger.debug(`PR event received: ${webhookEventId}`)

    try {
      const { event, payload: raw } =
        await this.webhooksService.loadAndDecryptPayload(webhookEventId)
      const eventType = event.eventType

      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSING)

      // ── Parse Azure PR resource ──────────────────────────────────────────────
      const resource = raw.resource as AzurePrResource
      const {
        pullRequestId,
        title,
        description = '',
        status: azureStatus,
        isDraft = false,
        repository,
        createdBy,
        sourceRefName,
        targetRefName,
        reviewers = [],
        commits = [],
        workItemRefs = [],
        closedDate,
      } = resource

      const azurePrId = String(pullRequestId)

      // ── Determine canonical status ───────────────────────────────────────────
      let status = EVENT_STATUS_MAP[eventType] ?? PullRequestStatus.ACTIVE
      if (azureStatus === 'active' && isDraft) {
        status = PullRequestStatus.DRAFT
      }

      // ── Extract commit IDs and work item IDs ─────────────────────────────────
      const commitIds = commits.map((c) => c.commitId).filter(Boolean)
      let workItemIds = workItemRefs.map((w) => Number(w.id)).filter(Boolean)

      // Azure's PR webhook payload almost always omits linked work items, and a
      // work item can be linked AFTER the PR is created. Read the authoritative
      // list from the Git API so PullRequest.workItemIds always reflects the real
      // links — every PR event (create/update/push) re-syncs it. Non-fatal.
      if (this.azureGitService) {
        try {
          const fetched = await this.azureGitService.getPullRequestWorkItemRefs(
            repository.id,
            pullRequestId,
            repository.project.name,
          )
          workItemIds = [...new Set([...workItemIds, ...fetched])]
        } catch (wiErr) {
          this.logger.warn(`Failed to fetch work items for PR #${azurePrId}: ${String(wiErr)}`)
        }
      }

      // ── Build timestamps for merge/completion ────────────────────────────────
      const now = new Date()
      const extraFields: Partial<{
        mergedAt: Date
        completedAt: Date
      }> = {}

      if (eventType === WebhookEventType.PR_MERGED) {
        extraFields.mergedAt = closedDate ? new Date(closedDate) : now
        extraFields.completedAt = extraFields.mergedAt
      } else if (
        eventType === WebhookEventType.PR_ABANDONED ||
        status === PullRequestStatus.COMPLETED
      ) {
        extraFields.completedAt = closedDate ? new Date(closedDate) : now
      }

      // ── Upsert PullRequest ───────────────────────────────────────────────────
      const upsertResult = await this.pullRequestModel
        .findOneAndUpdate(
          { azurePrId },
          {
            $set: {
              azurePrId,
              repositoryId: repository.id,
              repositoryName: repository.name,
              projectId: repository.project.id,
              projectName: repository.project.name,
              authorAzureId: createdBy.id,
              title,
              description,
              status,
              sourceBranch: sourceRefName.replace(/^refs\/heads\//, ''),
              targetBranch: targetRefName.replace(/^refs\/heads\//, ''),
              commitIds,
              workItemIds,
              reviewers: reviewers.map((r) => ({
                azureId: r.id,
                displayName: r.displayName,
                vote: r.vote,
              })),
              isDraft,
              ...extraFields,
            },
          },
          { upsert: true, new: true },
        )
        .exec()

      const prMongoId = upsertResult!._id.toString()

      // ── Auto-create developer from PR author (carries the real Azure GUID) ───
      // PR createdBy gives us the canonical azureId + display name (and usually
      // the email as uniqueName), which is higher-quality than commit git author
      // identity. Non-fatal: never let a developer write block PR processing.
      try {
        await this.developersService.findOrCreateFromAzureIdentity(
          createdBy.id,
          createdBy.displayName,
          createdBy.uniqueName,
        )
      } catch (devErr) {
        this.logger.warn(`Developer auto-create from PR #${azurePrId} failed: ${String(devErr)}`)
      }

      // ── Alert: PR has no linked work items and is not a draft ────────────────
      if (workItemIds.length === 0 && status !== PullRequestStatus.DRAFT) {
        await this.prAlertModel
          .updateOne(
            { azurePrId },
            {
              $set: {
                type: PrAlertType.NO_WORK_ITEMS,
                prTitle: title,
                authorAzureId: createdBy.id,
                repositoryName: repository.name,
                projectName: repository.project.name,
              },
              $setOnInsert: { resolvedAt: null },
            },
            { upsert: true },
          )
          .exec()
        this.logger.warn(`PR #${azurePrId} has no linked work items`)
      }

      // ── Back-link commits → this PR ──────────────────────────────────────────
      await this.commitsService.updatePullRequestId(commitIds, prMongoId)

      // ── Ingest the PR's commits from Azure (contribution + line stats) ───────
      // The PR webhook payload's `commits` is usually empty and git.push events
      // may not be configured, so we pull the PR's commits straight from the Git
      // API. Each commit is attributed to its git AUTHOR EMAIL (not the PR
      // creator), persisted with real file/line stats, and fed to AI analysis.
      await this.ingestPrCommits(resource, prMongoId)

      // ── Attribute ownership to the developer who did the work ────────────────
      // Azure's `createdBy` is merely whoever opened the PR, which may not be the
      // person who wrote the code (e.g. a lead opening a PR on a teammate's
      // behalf). Ownership must follow the actual work, so we override the PR
      // author with the dominant commit author. Falls back to `createdBy` only
      // when no commit is attributable yet. Every downstream metric (PR effort,
      // prCreated/prMerged rollups) reads PullRequest.authorAzureId, so updating
      // it here re-attributes the entire chain.
      const dominantAuthorId = await this.commitsService.getDominantAuthor(prMongoId)
      const ownerAzureId = dominantAuthorId ?? createdBy.id

      if (ownerAzureId !== createdBy.id) {
        await Promise.all([
          this.pullRequestModel
            .updateOne({ azurePrId }, { $set: { authorAzureId: ownerAzureId } })
            .exec(),
          // Keep the "no work items" alert (if any) attributed to the same owner.
          this.prAlertModel
            .updateOne({ azurePrId }, { $set: { authorAzureId: ownerAzureId } })
            .exec(),
        ])
        this.logger.debug(
          `PR #${azurePrId} ownership set to commit author ${ownerAzureId} ` +
            `(creator was ${createdBy.id})`,
        )
      }

      // Signal the PR-effort pipeline to (re)compute this PR's effort analysis
      // (AI estimate now; actual/variance once a work item is linked).
      this.eventEmitter.emit('analysis.pr.changed', { azurePrId })

      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSED)
      this.logger.debug(`PR event processed: ${webhookEventId} (PR #${azurePrId})`)
    } catch (err) {
      if (err instanceof AzureRateLimitError) {
        this.logger.warn(
          `PR event ${webhookEventId} deferred — Azure rate limited (retry in ${err.retryAfterMs} ms)`,
        )
        await this.webhooksService.markRateLimited(webhookEventId, err.retryAfterMs)
        return
      }
      this.logger.error(
        `PR processing failed: ${webhookEventId}`,
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

  /**
   * Pull the PR's commits from Azure and persist any that aren't stored yet,
   * each attributed to its git author email. Idempotent (skips known commits),
   * non-fatal, and a no-op when the Git service isn't configured. Rate-limit
   * errors bubble up so the whole event is deferred and retried.
   */
  private async ingestPrCommits(resource: AzurePrResource, prMongoId: string): Promise<void> {
    if (!this.azureGitService) return

    const { repository } = resource
    const azurePrId = resource.pullRequestId
    const prCommits = await this.azureGitService.getPullRequestCommits(
      repository.id,
      azurePrId,
      repository.project.name,
    )
    if (!prCommits.length) {
      if (process.env.AI_DEBUG === 'true') {
        this.logger.debug(`[input/pr] PR #${azurePrId} returned 0 commits from Azure Git API`)
      }
      return
    }

    let ingested = 0
    for (const c of prCommits) {
      if (await this.commitsService.exists(c.commitId)) continue

      // Real per-file + line stats (diffed against parent).
      const filesChanged = await this.azureGitService.getCommitChangedFiles(
        repository.id,
        c.commitId,
        repository.project.name,
      )

      // Attribute to the commit AUTHOR EMAIL — the developer who wrote the code,
      // regardless of who opened the PR or owns the work item.
      let authorAzureId = ''
      try {
        const dev = await this.developersService.findOrCreateFromCommit(c.authorName, c.authorEmail)
        authorAzureId = dev.azureDevOpsId
      } catch (devErr) {
        this.logger.warn(
          `Developer auto-create failed for commit ${c.commitId} <${c.authorEmail}>: ${String(devErr)}`,
        )
      }

      const commitDoc = await this.commitsService.create({
        azureCommitId: c.commitId,
        repositoryId: repository.id,
        repositoryName: repository.name,
        projectId: repository.project.id,
        projectName: repository.project.name,
        authorAzureId,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        branchName: resource.sourceRefName.replace(/^refs\/heads\//, ''),
        message: c.comment,
        pushedAt: c.authorDate ?? new Date(),
        filesChanged,
      })

      // Link to this PR so PR-effort/commit-history pick it up immediately.
      // Done even on the race below so the PR association is never lost.
      await this.commitsService.updatePullRequestId([c.commitId], prMongoId)

      // A concurrent ingestion already stored this commit (it's now linked
      // above) — skip the duplicate AI analysis and avoid double-counting.
      if (!commitDoc) continue

      if (process.env.AI_DEBUG === 'true') {
        this.logger.debug(
          `[input/pr-commit] PR #${azurePrId} ${c.commitId} author=<${c.authorEmail}> ` +
            `files=${commitDoc.totalFilesChanged} +${commitDoc.totalLinesAdded}/-${commitDoc.totalLinesRemoved} ` +
            `langs=[${commitDoc.languagesUsed.join(',')}]`,
        )
      }

      // Trigger AI commit analysis + real-time daily-summary projection.
      this.eventEmitter.emit('commit.saved', { commitId: commitDoc._id.toString() })
      ingested++
    }

    if (ingested > 0) {
      this.logger.log(`Ingested ${ingested} commit(s) for PR #${azurePrId} via Azure Git API`)
    }
  }
}
