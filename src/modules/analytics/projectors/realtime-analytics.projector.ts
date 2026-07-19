import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { PullRequest, PullRequestDocument } from '@app/database/schemas/pull-request.schema'
import { WorkItem, WorkItemDocument } from '@app/database/schemas/work-item.schema'

import { dayKey } from '@app/shared/helpers/timezone.helper'

import { DailySummaryCron } from '../crons/daily-summary.cron'

interface CommitEvent {
  commitId: string
}
interface PrChangedEvent {
  azurePrId: string
}
interface WorkItemChangedEvent {
  workItemId: number
}

/**
 * Near-real-time DailySummary projector.
 *
 * Listens to the same post-persist events the rest of the pipeline already
 * emits and incrementally recomputes the affected (developer, day) summary
 * cell, so Admins/Managers see up-to-date analytics within seconds instead of
 * waiting for the nightly cron. The cron stays on as a safety-net/reconciler
 * and continues to own monthly roll-ups.
 *
 * Design notes:
 *  - Idempotent: each recompute reads source collections and upserts the whole
 *    cell (see {@link DailySummaryCron.recalculateFor}); duplicate events (e.g.
 *    webhook retries) never double count.
 *  - Coalesced: rapid events for the same cell (a push with many commits, or
 *    commit.saved quickly followed by analysis.commit.completed) are debounced
 *    into a single recompute to avoid redundant aggregation under load.
 *  - Non-fatal: failures are logged, never thrown — a projection hiccup must
 *    not break ingestion, and the nightly cron will reconcile regardless.
 */
@Injectable()
export class RealtimeAnalyticsProjector {
  private readonly logger = new Logger(RealtimeAnalyticsProjector.name)
  private readonly debounceMs = 1500
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly dailySummaryCron: DailySummaryCron,
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @InjectModel(WorkItem.name)
    private readonly workItemModel: Model<WorkItemDocument>,
  ) {}

  // ── Commit activity ─────────────────────────────────────────────────────────

  /** Commit persisted — reflect commit counts/lines immediately. */
  @OnEvent('commit.saved', { async: true })
  async onCommitSaved(event: CommitEvent): Promise<void> {
    await this.fromCommit(event.commitId)
  }

  /** AI analysis finished — fold the efficiency score/effort into the cell. */
  @OnEvent('analysis.commit.completed', { async: true })
  async onCommitAnalyzed(event: CommitEvent): Promise<void> {
    await this.fromCommit(event.commitId)
  }

  private async fromCommit(commitId: string): Promise<void> {
    try {
      const commit = await this.commitModel
        .findById(commitId, { authorAzureId: 1, pushedAt: 1 })
        .lean()
        .exec()
      if (commit?.authorAzureId && commit.pushedAt) {
        this.schedule(commit.authorAzureId, dayKey(new Date(commit.pushedAt)))
      }
    } catch (err) {
      this.logger.warn(`Commit projection failed for ${commitId}: ${String(err)}`)
    }
  }

  // ── Pull request activity ───────────────────────────────────────────────────

  @OnEvent('analysis.pr.changed', { async: true })
  async onPrChanged(event: PrChangedEvent): Promise<void> {
    try {
      const pr = await this.pullRequestModel
        .findOne({ azurePrId: event.azurePrId }, { authorAzureId: 1, mergedAt: 1, createdAt: 1 })
        .lean()
        .exec()
      if (!pr?.authorAzureId) return

      // A PR can affect its creation day (prCreated) and its merge day (prMerged).
      const createdAt = (pr as { createdAt?: Date }).createdAt
      if (createdAt) this.schedule(pr.authorAzureId, dayKey(new Date(createdAt)))
      if (pr.mergedAt) this.schedule(pr.authorAzureId, dayKey(new Date(pr.mergedAt)))
    } catch (err) {
      this.logger.warn(`PR projection failed for #${event.azurePrId}: ${String(err)}`)
    }
  }

  // ── Work item activity ──────────────────────────────────────────────────────

  @OnEvent('analysis.workitem.changed', { async: true })
  async onWorkItemChanged(event: WorkItemChangedEvent): Promise<void> {
    try {
      const wi = await this.workItemModel
        .findOne({ azureWorkItemId: event.workItemId }, { assignedToAzureId: 1, closedAt: 1 })
        .lean()
        .exec()
      // workItemsCompleted is bucketed by closedAt for the assignee.
      if (wi?.assignedToAzureId && wi.closedAt) {
        this.schedule(wi.assignedToAzureId, dayKey(new Date(wi.closedAt)))
      }
    } catch (err) {
      this.logger.warn(`Work item projection failed for #${event.workItemId}: ${String(err)}`)
    }
  }

  // ── Coalescing scheduler ────────────────────────────────────────────────────

  /** Debounce recomputes per (developer, day) so bursts collapse into one run. */
  private schedule(developerAzureId: string, date: string): void {
    const key = `${developerAzureId}|${date}`
    const existing = this.pending.get(key)
    if (existing) clearTimeout(existing)

    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key)
        this.dailySummaryCron
          .recalculateFor(developerAzureId, date)
          .then(() => this.logger.debug(`Recomputed daily summary ${key}`))
          .catch((err) => this.logger.warn(`Recompute failed for ${key}: ${String(err)}`))
      }, this.debounceMs),
    )
  }
}
