import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, AnyBulkWriteOperation } from 'mongoose'
import { DailySummary, DailySummaryDocument } from '@app/database/schemas/daily-summary.schema'
import {
  MonthlySummary,
  MonthlySummaryDocument,
} from '@app/database/schemas/monthly-summary.schema'
import { previousMonthKey } from '@app/shared/helpers/timezone.helper'

/** Result of an on-demand or scheduled monthly roll-up. */
export interface MonthlyBuildResult {
  month: string
  upserted: number
  updated: number
}

const MONTH_RE = /^\d{4}-\d{2}$/

interface MonthlyAggRow {
  developerAzureId: string
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


@Injectable()
export class MonthlySummaryCron {
  private readonly logger = new Logger(MonthlySummaryCron.name)
  private isRunning = false

  constructor(
    @InjectModel(DailySummary.name)
    private readonly dailySummaryModel: Model<DailySummaryDocument>,
    @InjectModel(MonthlySummary.name)
    private readonly monthlySummaryModel: Model<MonthlySummaryDocument>,
  ) {}

  /** 01:00 UTC on the 1st of each month — roll up the previous month. */
  @Cron('0 1 1 * *')
  async buildMonthlySummaries(): Promise<void> {
    try {
      await this.buildForMonth()
    } catch (err) {
      this.logger.error(
        'Monthly summary cron failed',
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  /**
   * Publicly callable trigger — used by the on-demand admin API and the
   * "Sync Now" button on the Monthly Analytics page.
   *
   * Accepts an optional YYYY-MM month; defaults to the month that just ended
   * (the scheduled cron's behaviour). Rolls up existing daily summaries into
   * the monthly collection. Throws ConflictException if a build is already in
   * progress, BadRequestException on a malformed month.
   */
  async buildForMonth(monthParam?: string): Promise<MonthlyBuildResult> {
    if (monthParam && !MONTH_RE.test(monthParam)) {
      throw new BadRequestException('month must be in YYYY-MM format')
    }
    if (this.isRunning) {
      throw new ConflictException('A monthly analytics build is already in progress')
    }

    this.isRunning = true
    const monthStr = monthParam ?? previousMonthKey()
    this.logger.log(`Building monthly summaries for ${monthStr}`)

    try {
      const rows = await this.aggregateMonth(monthStr)

      // Drop monthly rows for developers who no longer have any activity this
      // month (e.g. a PR re-attributed away from them). Without this the rollup
      // is not idempotent and leaves stale credit behind. An empty active set
      // ($nin: []) clears every row for the month, which is the correct result
      // when the month has no daily activity at all.
      const activeDevIds = rows.map((r) => r.developerAzureId)
      const deletion = await this.monthlySummaryModel
        .deleteMany({ month: monthStr, developerAzureId: { $nin: activeDevIds } })
        .exec()

      if (!rows.length) {
        this.logger.log(
          `No daily summaries for ${monthStr} — cleared ${deletion.deletedCount} stale row(s)`,
        )
        return { month: monthStr, upserted: 0, updated: 0 }
      }

      const ops = rows.map((ms) => ({
        updateOne: {
          filter: { developerAzureId: ms.developerAzureId, month: monthStr },
          update: { $set: { ...ms, month: monthStr } },
          upsert: true,
        },
      }))

      const result = await this.monthlySummaryModel.bulkWrite(
        ops as AnyBulkWriteOperation<MonthlySummary>[],
        { ordered: false },
      )
      this.logger.log(
        `Monthly summaries for ${monthStr}: ` +
          `${result.upsertedCount} inserted, ${result.modifiedCount} updated, ` +
          `${deletion.deletedCount} removed`,
      )
      return { month: monthStr, upserted: result.upsertedCount, updated: result.modifiedCount }
    } finally {
      this.isRunning = false
    }
  }

  private async aggregateMonth(monthStr: string): Promise<MonthlyAggRow[]> {
    return this.dailySummaryModel.aggregate<MonthlyAggRow>([
      // ── 1. All daily records that belong to the target month ───────────────
      //    DailySummary.date is stored as 'YYYY-MM-DD'; prefix match is enough
      {
        $match: { date: { $regex: `^${monthStr}` } },
      },

      // ── 2. Roll up per developer ───────────────────────────────────────────
      {
        $group: {
          _id: '$developerAzureId',
          totalCommits: { $sum: '$totalCommits' },
          totalLinesAdded: { $sum: '$totalLinesAdded' },
          totalLinesRemoved: { $sum: '$totalLinesRemoved' },
          totalFilesChanged: { $sum: '$totalFilesChanged' },
          // Push each day's repository array — will be flattened + deduped next
          repoArrays: { $push: '$repositoriesWorkedOn' },
          // Collect daily average scores (may contain nulls)
          scoreAccum: { $push: '$avgEfficiencyScore' },
          totalEstimatedHours: { $sum: '$totalEstimatedHours' },
          totalActualHours: { $sum: '$totalActualHours' },
          prCreated: { $sum: '$prCreated' },
          prMerged: { $sum: '$prMerged' },
          workItemsCompleted: { $sum: '$workItemsCompleted' },
        },
      },

      // ── 3. Flatten the array-of-arrays into a deduplicated repo list ───────
      {
        $addFields: {
          repositoriesWorkedOn: {
            $reduce: {
              input: '$repoArrays',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
          // Remove null entries before averaging
          validScores: {
            $filter: {
              input: '$scoreAccum',
              cond: { $ne: ['$$this', null] },
            },
          },
        },
      },

      // ── 4. Compute weighted-average efficiency score ───────────────────────
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

      // ── 5. Final projection ────────────────────────────────────────────────
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
          prCreated: 1,
          prMerged: 1,
          workItemsCompleted: 1,
        },
      },
    ])
  }
}
