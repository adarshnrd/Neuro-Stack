import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, AnyBulkWriteOperation } from 'mongoose'
import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { AIAnalysis, AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import {
  PullRequest,
  PullRequestDocument,
  PullRequestStatus,
} from '@app/database/schemas/pull-request.schema'
import { WorkItem, WorkItemDocument } from '@app/database/schemas/work-item.schema'
import { DailySummary, DailySummaryDocument } from '@app/database/schemas/daily-summary.schema'
import { dayRange, yesterdayKey, todayKey } from '@app/shared/helpers/timezone.helper'

// ── Aggregation result interfaces ────────────────────────────────────────────

interface CommitAggRow {
  developerAzureId: string
  totalCommits: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  repositoriesWorkedOn: string[]
  avgEfficiencyScore: number | null
  totalEstimatedHours: number
  totalActualHours: number
}

interface PrAggRow {
  _id: string // authorAzureId
  prCreated: number
  prMerged: number
}

interface WiAggRow {
  _id: string // assignedToAzureId
  workItemsCompleted: number
}

export interface DailyBuildResult {
  date: string
  upserted: number
  updated: number
}

/** Result of an on-demand full-day rebuild (the daily "Sync" button). */
export interface DailyRebuildResult {
  date: string
  developers: number
}

/** A computed per-developer daily summary row (same shape persisted/served). */
export interface DailySummaryRow {
  developerAzureId: string
  date: string
  totalCommits: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  repositoriesWorkedOn: string[]
  avgEfficiencyScore: number | null
  totalEstimatedHours: number
  totalActualHours: number
  prCreated: number
  prMerged: number
  workItemsCompleted: number
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// Buckets follow the org reporting timezone (see timezone.helper), not UTC, so
// "today" on the dashboard matches the developers' local day.

function getYesterdayRange(): { startOfDay: Date; endOfDay: Date; dateStr: string } {
  const dateStr = yesterdayKey()
  const { start, end } = dayRange(dateStr)
  return { startOfDay: start, endOfDay: end, dateStr }
}

function parseDateRange(dateStr: string): { startOfDay: Date; endOfDay: Date; dateStr: string } {
  const { start, end } = dayRange(dateStr)
  return { startOfDay: start, endOfDay: end, dateStr }
}

// ── Cron ─────────────────────────────────────────────────────────────────────

@Injectable()
export class DailySummaryCron {
  private readonly logger = new Logger(DailySummaryCron.name)
  private isRunning = false

  constructor(
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
    @InjectModel(AIAnalysis.name)
    private readonly aiAnalysisModel: Model<AIAnalysisDocument>,
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @InjectModel(WorkItem.name)
    private readonly workItemModel: Model<WorkItemDocument>,
    @InjectModel(DailySummary.name)
    private readonly dailySummaryModel: Model<DailySummaryDocument>,
  ) {}

  /** Every day at 00:30 UTC — aggregate yesterday's developer activity. */
  @Cron('30 0 * * *')
  async buildDailySummaries(): Promise<void> {
    try {
      await this.buildForDate()
    } catch (err) {
      this.logger.error('Daily summary cron failed', err instanceof Error ? err.stack : String(err))
    }
  }

  /**
   * Publicly callable trigger — used by the on-demand admin API.
   * Accepts an optional YYYY-MM-DD date; defaults to yesterday (UTC).
   * Throws ConflictException if a build is already in progress.
   */
  async buildForDate(targetDate?: string): Promise<DailyBuildResult> {
    if (this.isRunning) {
      throw new ConflictException('A daily analytics build is already in progress')
    }

    this.isRunning = true
    const { startOfDay, endOfDay, dateStr } = targetDate
      ? parseDateRange(targetDate)
      : getYesterdayRange()

    this.logger.log(`Building daily summaries for ${dateStr}`)

    try {
      const rows = await this.computeRows(startOfDay, endOfDay, dateStr)

      if (!rows.length) {
        this.logger.log(`No commits on ${dateStr} — nothing to summarise`)
        return { date: dateStr, upserted: 0, updated: 0 }
      }

      const ops = rows.map((r) => ({
        updateOne: {
          filter: { developerAzureId: r.developerAzureId, date: dateStr },
          update: { $set: r },
          upsert: true,
        },
      }))

      const result = await this.dailySummaryModel.bulkWrite(
        ops as AnyBulkWriteOperation<DailySummary>[],
        { ordered: false },
      )

      this.logger.log(
        `Daily summaries for ${dateStr}: ${result.upsertedCount} inserted, ${result.modifiedCount} updated`,
      )
      return { date: dateStr, upserted: result.upsertedCount, updated: result.modifiedCount }
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Compute live daily-summary rows for a date WITHOUT persisting them.
   *
   * Used as a read-time fallback by the analytics API so the dashboard reflects
   * the current day's activity immediately, instead of staying blank until the
   * nightly cron writes the `DailySummary` documents. Same aggregation the cron
   * persists, so the numbers are identical once the cron has run.
   */
  async previewForDate(dateStr: string): Promise<DailySummaryRow[]> {
    const { startOfDay, endOfDay } = parseDateRange(dateStr)
    return this.computeRows(startOfDay, endOfDay, dateStr)
  }

  /**
   * On-demand full rebuild of one day — powers the "Sync" button on the daily
   * analytics page. Unlike the commit-driven bulk build, this recomputes EVERY
   * developer with any activity that day (commits, PRs created/merged, or work
   * items closed), plus anyone who currently has a row for the day, so PR-only
   * / work-item-only cells are handled and now-empty cells are deleted.
   */
  async rebuildForDate(dateParam?: string): Promise<DailyRebuildResult> {
    const dateStr = dateParam ?? todayKey()
    const { startOfDay, endOfDay } = parseDateRange(dateStr)
    const inDay = { $gte: startOfDay, $lte: endOfDay }

    const [commitDevs, prCreatedDevs, prMergedDevs, wiDevs, existingDevs] = await Promise.all([
      this.commitModel.distinct('authorAzureId', { pushedAt: inDay }),
      this.pullRequestModel.distinct('authorAzureId', { createdAt: inDay }),
      this.pullRequestModel.distinct('authorAzureId', { mergedAt: inDay }),
      this.workItemModel.distinct('assignedToAzureId', { closedAt: inDay }),
      this.dailySummaryModel.distinct('developerAzureId', { date: dateStr }),
    ])

    const devs = new Set<string>(
      [...commitDevs, ...prCreatedDevs, ...prMergedDevs, ...wiDevs, ...existingDevs].filter(
        (id): id is string => !!id,
      ),
    )

    for (const dev of devs) {
      await this.recalculateFor(dev, dateStr)
    }

    this.logger.log(`Rebuilt daily summaries for ${dateStr}: ${devs.size} developer(s)`)
    return { date: dateStr, developers: devs.size }
  }

  /**
   * Real-time projection: recompute ONE developer's summary for ONE day and
   * upsert it. Called by the event-driven projector as commits / PRs / work
   * items arrive, so Admins/Managers see fresh numbers within seconds instead
   * of waiting for the nightly cron.
   *
   * Idempotent by construction — it recomputes from the source collections and
   * upserts the whole cell, so handling the same event twice (e.g. webhook
   * retries) yields the identical document with no double counting. When a cell
   * has no remaining activity (e.g. a commit/PR was removed) the stale summary
   * is deleted so the dashboard never shows an empty ghost row.
   */
  async recalculateFor(developerAzureId: string, dateStr: string): Promise<void> {
    if (!developerAzureId) return
    const { startOfDay, endOfDay } = parseDateRange(dateStr)

    const [commitRows, prRows, wiRows] = await Promise.all([
      this.aggregateCommits(startOfDay, endOfDay, developerAzureId),
      this.aggregatePullRequests(startOfDay, endOfDay, developerAzureId),
      this.aggregateWorkItems(startOfDay, endOfDay, developerAzureId),
    ])

    const cs = commitRows[0]
    const prCreated = prRows[0]?.prCreated ?? 0
    const prMerged = prRows[0]?.prMerged ?? 0
    const workItemsCompleted = wiRows[0]?.workItemsCompleted ?? 0

    const hasActivity = !!cs || prCreated > 0 || prMerged > 0 || workItemsCompleted > 0
    if (!hasActivity) {
      await this.dailySummaryModel.deleteOne({ developerAzureId, date: dateStr }).exec()
      return
    }

    const row: DailySummaryRow = {
      developerAzureId,
      date: dateStr,
      totalCommits: cs?.totalCommits ?? 0,
      totalLinesAdded: cs?.totalLinesAdded ?? 0,
      totalLinesRemoved: cs?.totalLinesRemoved ?? 0,
      totalFilesChanged: cs?.totalFilesChanged ?? 0,
      repositoriesWorkedOn: cs?.repositoriesWorkedOn ?? [],
      avgEfficiencyScore: cs?.avgEfficiencyScore ?? null,
      totalEstimatedHours: cs?.totalEstimatedHours ?? 0,
      totalActualHours: cs?.totalActualHours ?? 0,
      prCreated,
      prMerged,
      workItemsCompleted,
    }

    await this.dailySummaryModel
      .updateOne({ developerAzureId, date: dateStr }, { $set: row }, { upsert: true })
      .exec()
  }

  // ── Private aggregation helpers ─────────────────────────────────────────

  /** Run the commit/PR/work-item aggregations and merge them per developer. */
  private async computeRows(
    startOfDay: Date,
    endOfDay: Date,
    dateStr: string,
  ): Promise<DailySummaryRow[]> {
    const [commitRows, prRows, wiRows] = await Promise.all([
      this.aggregateCommits(startOfDay, endOfDay),
      this.aggregatePullRequests(startOfDay, endOfDay),
      this.aggregateWorkItems(startOfDay, endOfDay),
    ])

    if (!commitRows.length) return []

    const prByAuthor = new Map(prRows.map((r) => [r._id, r]))
    const wiByAuthor = new Map(wiRows.map((r) => [r._id, r]))

    return commitRows.map((cs) => ({
      developerAzureId: cs.developerAzureId,
      date: dateStr,
      totalCommits: cs.totalCommits,
      totalLinesAdded: cs.totalLinesAdded,
      totalLinesRemoved: cs.totalLinesRemoved,
      totalFilesChanged: cs.totalFilesChanged,
      repositoriesWorkedOn: cs.repositoriesWorkedOn,
      avgEfficiencyScore: cs.avgEfficiencyScore,
      totalEstimatedHours: cs.totalEstimatedHours,
      totalActualHours: cs.totalActualHours,
      prCreated: prByAuthor.get(cs.developerAzureId)?.prCreated ?? 0,
      prMerged: prByAuthor.get(cs.developerAzureId)?.prMerged ?? 0,
      workItemsCompleted: wiByAuthor.get(cs.developerAzureId)?.workItemsCompleted ?? 0,
    }))
  }

  private async aggregateCommits(
    startOfDay: Date,
    endOfDay: Date,
    developerAzureId?: string,
  ): Promise<CommitAggRow[]> {
    const aiCollectionName = this.aiAnalysisModel.collection.name

    const match: Record<string, unknown> = { pushedAt: { $gte: startOfDay, $lte: endOfDay } }
    if (developerAzureId) match.authorAzureId = developerAzureId

    return this.commitModel.aggregate<CommitAggRow>([
      {
        $match: match,
      },
      {
        $lookup: {
          from: aiCollectionName,
          localField: '_id',
          foreignField: 'commitId',
          as: 'aiAnalysis',
        },
      },
      {
        $addFields: {
          analysis: { $arrayElemAt: ['$aiAnalysis', 0] },
        },
      },
      {
        $group: {
          _id: '$authorAzureId',
          totalCommits: { $sum: 1 },
          totalLinesAdded: { $sum: '$totalLinesAdded' },
          totalLinesRemoved: { $sum: '$totalLinesRemoved' },
          totalFilesChanged: { $sum: '$totalFilesChanged' },
          repositoriesWorkedOn: { $addToSet: '$repositoryId' },
          rawScores: { $push: '$analysis.efficiencyScore' },
          totalEstimatedHours: {
            $sum: { $ifNull: ['$analysis.estimatedEffortHours', 0] },
          },
          totalActualHours: {
            $sum: { $ifNull: ['$analysis.actualEffortHours', 0] },
          },
        },
      },
      {
        $addFields: {
          validScores: {
            $filter: {
              input: '$rawScores',
              cond: {
                $and: [{ $ne: ['$$this', null] }, { $ne: ['$$this', undefined] }],
              },
            },
          },
        },
      },
      {
        $addFields: {
          avgEfficiencyScore: {
            $cond: {
              if: { $gt: [{ $size: '$validScores' }, 0] },
              then: { $round: [{ $avg: '$validScores' }, 1] },
              else: null,
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          developerAzureId: '$_id',
          totalCommits: 1,
          totalLinesAdded: 1,
          totalLinesRemoved: 1,
          totalFilesChanged: 1,
          repositoriesWorkedOn: 1,
          avgEfficiencyScore: 1,
          totalEstimatedHours: 1,
          totalActualHours: 1,
        },
      },
    ])
  }

  private async aggregatePullRequests(
    startOfDay: Date,
    endOfDay: Date,
    developerAzureId?: string,
  ): Promise<PrAggRow[]> {
    const match: Record<string, unknown> = {
      $or: [
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { mergedAt: { $gte: startOfDay, $lte: endOfDay } },
      ],
    }
    if (developerAzureId) match.authorAzureId = developerAzureId

    return this.pullRequestModel.aggregate<PrAggRow>([
      {
        $match: match,
      },
      {
        $group: {
          _id: '$authorAzureId',
          prCreated: {
            $sum: {
              $cond: [
                {
                  $and: [{ $gte: ['$createdAt', startOfDay] }, { $lte: ['$createdAt', endOfDay] }],
                },
                1,
                0,
              ],
            },
          },
          prMerged: {
            // Only count a PR as merged when it is actually COMPLETED — a stray
            // mergedAt timestamp on an active/abandoned PR (e.g. a merged PR
            // later reopened, or seeded data) must not inflate this.
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', PullRequestStatus.COMPLETED] },
                    { $gte: ['$mergedAt', startOfDay] },
                    { $lte: ['$mergedAt', endOfDay] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])
  }

  private async aggregateWorkItems(
    startOfDay: Date,
    endOfDay: Date,
    developerAzureId?: string,
  ): Promise<WiAggRow[]> {
    const match: Record<string, unknown> = {
      closedAt: { $gte: startOfDay, $lte: endOfDay },
      assignedToAzureId: developerAzureId ?? { $exists: true, $ne: null },
    }

    return this.workItemModel.aggregate<WiAggRow>([
      {
        $match: match,
      },
      {
        $group: {
          _id: '$assignedToAzureId',
          workItemsCompleted: { $sum: 1 },
        },
      },
    ])
  }
}
