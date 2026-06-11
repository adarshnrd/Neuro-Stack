import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { WebhookEventStatus } from '@app/database/schemas/webhook-event.schema'
import type { ChangedFile } from '@app/shared/helpers/diff-parser.helper'
import { AZURE_GIT_SERVICE, IAzureGitService } from '@app/shared/interfaces/azure-git.interface'
import { AzureRateLimitError } from '@app/shared/azure/azure-rate-limit.error'
import { DevelopersService } from '@app/modules/developers/developers.service'
import { WebhooksService } from '../webhooks.service'
import { CommitsService } from '../services/commits.service'

interface PushEventPayload {
  webhookEventId: string
}

// Typed shapes matching Azure DevOps git.push resource payload
interface AzureRepo {
  id: string
  name: string
  project: { id: string; name: string }
}

interface AzureCommitRef {
  commitId: string
  author: { name: string; email: string; date?: string }
  comment?: string
  workItems?: Array<{ id: string | number }>
}

interface AzurePushResource {
  repository: AzureRepo
  refUpdates: Array<{ name: string }>
  commits: AzureCommitRef[]
  date?: string
}

@Injectable()
export class PushEventProcessor {
  private readonly logger = new Logger(PushEventProcessor.name)

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly commitsService: CommitsService,
    private readonly developersService: DevelopersService,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(AZURE_GIT_SERVICE)
    private readonly azureGitService?: IAzureGitService,
  ) {}

  @OnEvent('webhook.push', { async: true })
  async handle(payload: PushEventPayload): Promise<void> {
    const { webhookEventId } = payload
    this.logger.debug(`Push event received: ${webhookEventId}`)

    try {
      const { payload: raw } = await this.webhooksService.loadAndDecryptPayload(webhookEventId)

      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSING)

      // ── Parse Azure push resource ──────────────────────────────────────────
      const resource = raw.resource as AzurePushResource
      const { repository, refUpdates, commits = [], date: pushDate } = resource

      const rawBranch = refUpdates?.[0]?.name ?? ''
      const branchName = rawBranch.replace(/^refs\/heads\//, '')

      // ── Process each commit in the push ────────────────────────────────────
      for (const commit of commits) {
        if (!commit.commitId) continue

        // a) Idempotency guard
        if (await this.commitsService.exists(commit.commitId)) {
          this.logger.debug(`Commit already stored, skipping: ${commit.commitId}`)
          continue
        }

        // b) Fetch real per-file + line stats from Azure API (no-op if absent)
        let parsedFiles: ChangedFile[] = []
        if (this.azureGitService) {
          try {
            parsedFiles = await this.azureGitService.getCommitChangedFiles(
              repository.id,
              commit.commitId,
              repository.project.name,
            )
          } catch (diffErr) {
            // Rate-limit must bubble to the outer handler so the whole event is
            // deferred and reprocessed — never silently drop the commit's diff.
            if (diffErr instanceof AzureRateLimitError) throw diffErr
            this.logger.warn(`Diff fetch failed for ${commit.commitId}: ${String(diffErr)}`)
          }
        }

        // c–d) Resolve or auto-create the developer record from commit author info
        let authorAzureId = ''
        try {
          const dev = await this.developersService.findOrCreateFromCommit(
            commit.author.name ?? '',
            commit.author.email ?? '',
          )
          authorAzureId = dev.azureDevOpsId
        } catch (devErr) {
          // Non-fatal — commit is still stored; developer can be reconciled on
          // next sync. Log it though: a silent failure here is exactly why a
          // developer profile can go missing for a pushed commit.
          this.logger.warn(
            `Developer auto-create failed for commit ${commit.commitId} ` +
              `(author="${commit.author?.name ?? ''}" <${commit.author?.email ?? ''}>): ${String(devErr)}`,
          )
        }

        // e) Extract work item IDs (Azure encodes as string integers)
        const workItemIds = (commit.workItems ?? []).map((w) => Number(w.id)).filter(Boolean)

        // f) Persist commit document
        const commitDoc = await this.commitsService.create({
          azureCommitId: commit.commitId,
          repositoryId: repository.id,
          repositoryName: repository.name,
          projectId: repository.project.id,
          projectName: repository.project.name,
          authorAzureId,
          authorName: commit.author.name ?? '',
          authorEmail: (commit.author.email ?? '').toLowerCase(),
          branchName,
          message: commit.comment ?? '',
          pushedAt: new Date(pushDate ?? commit.author.date ?? Date.now()),
          filesChanged: parsedFiles,
          workItemIds,
        })

        // A concurrent ingestion already stored this commit — skip to avoid
        // double-counting (and a duplicate AI analysis).
        if (!commitDoc) continue

        if (process.env.AI_DEBUG === 'true') {
          this.logger.debug(
            `[input/commit] ${commit.commitId} repo="${repository.name}" branch="${branchName}" ` +
              `files=${parsedFiles.length} +${commitDoc.totalLinesAdded}/-${commitDoc.totalLinesRemoved} ` +
              `langs=[${commitDoc.languagesUsed.join(',')}] workItems=[${workItemIds.join(',')}] ` +
              `diffParsed=${this.azureGitService ? 'yes' : 'no-git-service'}`,
          )
        }

        // g) Signal downstream pipeline (AI analysis, daily summaries, etc.)
        this.eventEmitter.emit('commit.saved', {
          commitId: commitDoc._id.toString(),
        })
      }

      await this.webhooksService.updateStatus(webhookEventId, WebhookEventStatus.PROCESSED)
      this.logger.debug(`Push event processed: ${webhookEventId} (${commits.length} commits)`)
    } catch (err) {
      if (err instanceof AzureRateLimitError) {
        this.logger.warn(
          `Push event ${webhookEventId} deferred — Azure rate limited (retry in ${err.retryAfterMs} ms)`,
        )
        await this.webhooksService.markRateLimited(webhookEventId, err.retryAfterMs)
        return
      }
      this.logger.error(
        `Push processing failed: ${webhookEventId}`,
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
