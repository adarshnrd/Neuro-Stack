import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model, Types } from 'mongoose'

import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { AIAnalysis, AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import {
  PullRequest,
  PullRequestDocument,
  PullRequestStatus,
} from '@app/database/schemas/pull-request.schema'
import { DailySummary, DailySummaryDocument } from '@app/database/schemas/daily-summary.schema'
import {
  MonthlySummary,
  MonthlySummaryDocument,
} from '@app/database/schemas/monthly-summary.schema'
import { TriggerLog, TriggerLogDocument } from '@app/database/schemas/trigger-log.schema'
import { LoginEvent, LoginEventDocument } from '@app/database/schemas/login-event.schema'
import {
  PrEffortAnalysis,
  PrEffortAnalysisDocument,
} from '@app/database/schemas/pr-effort-analysis.schema'

import { UserDocument } from '@app/users/schemas/user.schema'
import { PaginatedResult } from '@app/common/types'
import { DevelopersService } from '@app/modules/developers/developers.service'
import { dayRange, todayKey, currentMonthKey } from '@app/shared/helpers/timezone.helper'
import { DailySummaryCron, type DailySummaryRow } from './crons/daily-summary.cron'

// Structural shape shared by a persisted (lean) DailySummary document and a
// live-computed DailySummaryRow — lets the read path treat both uniformly.
type DailyRowLike = DailySummaryRow

import {
  type CommitWithAnalysisDto,
  type DailySummaryWithUserDto,
  type MonthlySummaryWithUserDto,
  type OrgOverviewDto,
  type PrWithAuthorDto,
  type PrEffortDto,
  type PrCommitDto,
  type ProjectSummaryDto,
  type DailyLoginCountDto,
  type LoginEventRecordDto,
  type OrgDailyEffortDto,
} from './dto/analytics.dto'

// ── Date helpers ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000
const PAD = (n: number) => String(n).padStart(2, '0')

function daysBetween(fromStr: string, toStr: string): number {
  return (new Date(toStr).getTime() - new Date(fromStr).getTime()) / MS_PER_DAY
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name)

  constructor(
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
    @InjectModel(AIAnalysis.name)
    private readonly aiAnalysisModel: Model<AIAnalysisDocument>,
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @InjectModel(DailySummary.name)
    private readonly dailySummaryModel: Model<DailySummaryDocument>,
    @InjectModel(MonthlySummary.name)
    private readonly monthlySummaryModel: Model<MonthlySummaryDocument>,
    @InjectModel(TriggerLog.name)
    private readonly triggerLogModel: Model<TriggerLogDocument>,
    @InjectModel(LoginEvent.name)
    private readonly loginEventModel: Model<LoginEventDocument>,
    @InjectModel(PrEffortAnalysis.name)
    private readonly prEffortModel: Model<PrEffortAnalysisDocument>,
    private readonly developersService: DevelopersService,
    private readonly dailySummaryCron: DailySummaryCron,
  ) {}

  // ── Developer display-name map ────────────────────────────────────────────
  // Resolves azureDevOpsId → display name from the developers collection
  // (developers are no longer auth users).

  private async buildDisplayNameMap(azureIds: string[]): Promise<Map<string, string>> {
    return this.developersService.buildDisplayNameMap(azureIds)
  }

  // ── 1. Org overview ───────────────────────────────────────────────────────

  async getOrgOverview(dateParam?: string): Promise<OrgOverviewDto> {
    const date = dateParam ?? todayKey()
    const { start, end } = dayRange(date)
    const weekStart = new Date(start.getTime() - 6 * MS_PER_DAY)

    // Run all independent DB operations concurrently
    const [
      totalCommitsToday,
      totalCommitsThisWeek,
      activeDevelopersAgg,
      linesAgg,
      scoreAgg,
      topRaw,
      missingWorkItemPrCount,
    ] = await Promise.all([
      // Total commits on the target day
      this.commitModel.countDocuments({ pushedAt: { $gte: start, $lte: end } }),

      // Rolling 7-day commit count ending at end-of-target-day
      this.commitModel.countDocuments({ pushedAt: { $gte: weekStart, $lte: end } }),

      // Distinct developer count for target day
      this.commitModel.aggregate<{ count: number }>([
        { $match: { pushedAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$authorAzureId' } },
        { $count: 'count' },
      ]),

      // Total lines added on the target day
      this.commitModel.aggregate<{ total: number }>([
        { $match: { pushedAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalLinesAdded' },
          },
        },
      ]),

      // Org-wide average efficiency score for the target day (from daily summaries)
      this.dailySummaryModel.aggregate<{ avg: number }>([
        {
          $match: {
            date,
            avgEfficiencyScore: { $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            avg: { $avg: '$avgEfficiencyScore' },
          },
        },
      ]),

      // Top 5 performers by efficiency score
      this.dailySummaryModel.find({ date }).sort({ avgEfficiencyScore: -1 }).limit(5).lean().exec(),

      // PRs with empty work item links that are still open or completed
      this.pullRequestModel.countDocuments({
        workItemIds: { $size: 0 },
        status: { $in: [PullRequestStatus.ACTIVE, PullRequestStatus.COMPLETED] },
      }),
    ])

    // Top performers + org avg score come from DailySummary. Before the nightly
    // cron has run for `date` there are none, so fall back to a live computation
    // from commits/AI analyses so the dashboard isn't blank for the current day.
    let topRows: DailyRowLike[] = topRaw as unknown as DailyRowLike[]
    let orgAvg: number | null = scoreAgg[0]?.avg ?? null

    if (!topRows.length) {
      const live = await this.dailySummaryCron.previewForDate(date)
      topRows = [...live]
        .sort((a, b) => (b.avgEfficiencyScore ?? -1) - (a.avgEfficiencyScore ?? -1))
        .slice(0, 5)
      const scored = live.filter((r) => r.avgEfficiencyScore != null)
      orgAvg = scored.length
        ? scored.reduce((s, r) => s + (r.avgEfficiencyScore as number), 0) / scored.length
        : null
    }

    const displayNameMap = await this.buildDisplayNameMap(topRows.map((r) => r.developerAzureId))

    const topPerformers: DailySummaryWithUserDto[] = topRows.map((r) => ({
      developerAzureId: r.developerAzureId,
      date: r.date,
      displayName: displayNameMap.get(r.developerAzureId),
      totalCommits: r.totalCommits,
      totalLinesAdded: r.totalLinesAdded,
      totalLinesRemoved: r.totalLinesRemoved,
      totalFilesChanged: r.totalFilesChanged,
      repositoriesWorkedOn: r.repositoriesWorkedOn,
      avgEfficiencyScore: r.avgEfficiencyScore ?? null,
      totalEstimatedHours: r.totalEstimatedHours,
      totalActualHours: r.totalActualHours,
      prCreated: r.prCreated,
      prMerged: r.prMerged,
      workItemsCompleted: r.workItemsCompleted,
    }))

    return {
      date,
      totalCommitsToday,
      totalCommitsThisWeek,
      activeDevelopersToday: activeDevelopersAgg[0]?.count ?? 0,
      totalLinesAddedToday: linesAgg[0]?.total ?? 0,
      orgAvgEfficiencyScore: orgAvg != null ? Math.round(orgAvg * 10) / 10 : null,
      topPerformers,
      missingWorkItemPrCount,
    }
  }

  // ── 2. Org daily summaries ────────────────────────────────────────────────

  async getOrgDailySummaries(dateParam?: string): Promise<DailySummaryWithUserDto[]> {
    const date = dateParam ?? todayKey()

    const persisted = await this.dailySummaryModel
      .find({ date })
      .sort({ avgEfficiencyScore: -1 })
      .lean()
      .exec()

    // Live fallback for the current day before the nightly cron persists rows.
    const rows: DailyRowLike[] = persisted.length
      ? (persisted as unknown as DailyRowLike[])
      : [...(await this.dailySummaryCron.previewForDate(date))].sort(
          (a, b) => (b.avgEfficiencyScore ?? -1) - (a.avgEfficiencyScore ?? -1),
        )

    const displayNameMap = await this.buildDisplayNameMap(rows.map((r) => r.developerAzureId))

    return rows.map((r) => ({
      developerAzureId: r.developerAzureId,
      date: r.date,
      displayName: displayNameMap.get(r.developerAzureId),
      totalCommits: r.totalCommits,
      totalLinesAdded: r.totalLinesAdded,
      totalLinesRemoved: r.totalLinesRemoved,
      totalFilesChanged: r.totalFilesChanged,
      repositoriesWorkedOn: r.repositoriesWorkedOn,
      avgEfficiencyScore: r.avgEfficiencyScore ?? null,
      totalEstimatedHours: r.totalEstimatedHours,
      totalActualHours: r.totalActualHours,
      prCreated: r.prCreated,
      prMerged: r.prMerged,
      workItemsCompleted: r.workItemsCompleted,
    }))
  }

  // ── 2b. Org daily PR effort rollup ────────────────────────────────────────

  /**
   * Aggregates per-PR effort (estimated vs developer-reported hours) for every
   * developer who had PR commit activity on the given day. Mirrors the totals
   * shown in each developer's PR Work Analysis table for that date window.
   */
  async getOrgPrEffortByDay(dateParam?: string): Promise<OrgDailyEffortDto[]> {
    const date = dateParam ?? todayKey()

    const rows = await this.prEffortModel.find({ activeDates: date }).lean().exec()

    const byDev = new Map<
      string,
      {
        estimatedHours: number
        reportedHours: number
        efficiencyScores: number[]
        prCount: number
        measuredPrCount: number
      }
    >()

    for (const r of rows) {
      const id = r.authorAzureId
      let entry = byDev.get(id)
      if (!entry) {
        entry = {
          estimatedHours: 0,
          reportedHours: 0,
          efficiencyScores: [],
          prCount: 0,
          measuredPrCount: 0,
        }
        byDev.set(id, entry)
      }

      entry.estimatedHours += r.estimatedHours ?? r.estimatedHoursMid ?? 0
      if (r.actualHours != null) {
        entry.reportedHours += r.actualHours
        entry.measuredPrCount += 1
      }
      if (r.efficiencyScore != null) {
        entry.efficiencyScores.push(r.efficiencyScore)
      }
      entry.prCount += 1
    }

    const azureIds = [...byDev.keys()]
    const displayNameMap = await this.buildDisplayNameMap(azureIds)

    const result: OrgDailyEffortDto[] = azureIds.map((developerAzureId) => {
      const e = byDev.get(developerAzureId)!
      const avgEfficiencyScore = e.efficiencyScores.length
        ? Math.round(
            (e.efficiencyScores.reduce((sum, v) => sum + v, 0) / e.efficiencyScores.length) * 10,
          ) / 10
        : null
      const variancePercent =
        e.estimatedHours > 0
          ? Math.round(((e.reportedHours - e.estimatedHours) / e.estimatedHours) * 100)
          : null

      return {
        developerAzureId,
        displayName: displayNameMap.get(developerAzureId),
        estimatedHours: Math.round(e.estimatedHours * 100) / 100,
        reportedHours: Math.round(e.reportedHours * 100) / 100,
        avgEfficiencyScore,
        variancePercent,
        prCount: e.prCount,
        measuredPrCount: e.measuredPrCount,
      }
    })

    result.sort((a, b) => {
      const aKey = a.reportedHours > 0 ? a.reportedHours : a.estimatedHours
      const bKey = b.reportedHours > 0 ? b.reportedHours : b.estimatedHours
      return bKey - aKey
    })

    return result
  }

  // ── 3. Org monthly summaries ──────────────────────────────────────────────

  async getOrgMonthlySummaries(monthParam?: string): Promise<MonthlySummaryWithUserDto[]> {
    const month = monthParam ?? currentMonthKey()
    const rows = await this.monthlySummaryModel
      .find({ month })
      .sort({ totalCommits: -1 })
      .lean()
      .exec()

    const displayNameMap = await this.buildDisplayNameMap(rows.map((r) => r.developerAzureId))

    return rows.map((r) => ({
      developerAzureId: r.developerAzureId,
      month: r.month,
      displayName: displayNameMap.get(r.developerAzureId),
      totalCommits: r.totalCommits,
      totalLinesAdded: r.totalLinesAdded,
      totalLinesRemoved: r.totalLinesRemoved,
      totalFilesChanged: r.totalFilesChanged,
      repositoriesWorkedOn: r.repositoriesWorkedOn,
      avgEfficiencyScore: r.avgEfficiencyScore ?? null,
      totalEstimatedHours: r.totalEstimatedHours,
      totalActualHours: r.totalActualHours,
      prCreated: r.prCreated,
      prMerged: r.prMerged,
      workItemsCompleted: r.workItemsCompleted,
    }))
  }

  // ── 4. Developer daily summaries ─────────────────────────────────────────

  async getDeveloperDailySummaries(
    currentUser: UserDocument,
    azureId: string,
    from: string | undefined,
    to: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<DailySummaryDocument>> {
    const today = todayKey()
    const fromStr = from ?? today
    const toStr = to ?? today

    if (daysBetween(fromStr, toStr) > 90) {
      throw new BadRequestException('Date range cannot exceed 90 days')
    }

    const filter: FilterQuery<DailySummaryDocument> = {
      developerAzureId: azureId,
      date: { $gte: fromStr, $lte: toStr },
    }

    const [items, total] = await Promise.all([
      this.dailySummaryModel
        .find(filter)
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.dailySummaryModel.countDocuments(filter),
    ])

    return {
      items: items as unknown as DailySummaryDocument[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  // ── 5. Developer monthly summaries ───────────────────────────────────────

  async getDeveloperMonthlySummaries(
    currentUser: UserDocument,
    azureId: string,
    from: string | undefined,
    to: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<MonthlySummaryDocument>> {
    const currentMonth = currentMonthKey()
    const fromStr = from ?? currentMonth
    const toStr = to ?? currentMonth

    const filter: FilterQuery<MonthlySummaryDocument> = {
      developerAzureId: azureId,
      month: { $gte: fromStr, $lte: toStr },
    }

    const [items, total] = await Promise.all([
      this.monthlySummaryModel
        .find(filter)
        .sort({ month: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.monthlySummaryModel.countDocuments(filter),
    ])

    return {
      items: items as unknown as MonthlySummaryDocument[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  // ── 6. Developer commits (with AI analysis + PR status) ──────────────────

  async getDeveloperCommits(
    currentUser: UserDocument,
    azureId: string,
    dateParam: string | undefined,
    repositoryId: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<CommitWithAnalysisDto>> {
    const filter: FilterQuery<CommitDocument> = { authorAzureId: azureId }

    if (dateParam) {
      const { start, end } = dayRange(dateParam)
      filter.pushedAt = { $gte: start, $lte: end }
    }

    if (repositoryId) {
      filter.repositoryId = repositoryId
    }

    const [commits, total] = await Promise.all([
      this.commitModel
        .find(filter)
        .sort({ pushedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.commitModel.countDocuments(filter),
    ])

    if (!commits.length) {
      return { items: [], total: 0, page, totalPages: 0 }
    }

    // ── Batch-load AI analyses ─────────────────────────────────────────────
    const commitObjectIds = commits.map((c) => c._id as unknown as Types.ObjectId)

    const analyses = await this.aiAnalysisModel
      .find({ commitId: { $in: commitObjectIds } })
      .lean()
      .exec()

    const analysisMap = new Map(analyses.map((a) => [a.commitId.toString(), a]))

    // ── Batch-load pull requests for commits that have a linked PR ─────────
    const prIds = [
      ...new Set(commits.map((c) => c.pullRequestId).filter((id): id is string => !!id)),
    ]

    const prMap = new Map<string, string>() // prObjectId → status
    if (prIds.length) {
      const prs = await this.pullRequestModel
        .find({ _id: { $in: prIds.map((id) => new Types.ObjectId(id)) } })
        .select('_id status')
        .lean()
        .exec()
      prs.forEach((pr) =>
        prMap.set((pr._id as unknown as { toString(): string }).toString(), pr.status as string),
      )
    }

    const items: CommitWithAnalysisDto[] = commits.map((c) => {
      const cId = (c._id as unknown as { toString(): string }).toString()
      const analysis = analysisMap.get(cId) ?? null
      const prStatus = c.pullRequestId ? (prMap.get(c.pullRequestId) ?? null) : null

      return {
        id: cId,
        azureCommitId: c.azureCommitId,
        repositoryId: c.repositoryId,
        repositoryName: c.repositoryName,
        projectName: c.projectName,
        authorAzureId: c.authorAzureId,
        authorName: c.authorName,
        message: c.message,
        branchName: c.branchName,
        pushedAt: c.pushedAt,
        totalLinesAdded: c.totalLinesAdded,
        totalLinesRemoved: c.totalLinesRemoved,
        totalFilesChanged: c.totalFilesChanged,
        languagesUsed: c.languagesUsed,
        analysis: analysis
          ? {
              efficiencyScore: analysis.efficiencyScore,
              complexityLevel: analysis.complexityLevel,
              technicalSummary: analysis.technicalSummary,
              estimatedEffortHours: analysis.estimatedEffortHours,
            }
          : null,
        prStatus,
      }
    })

    return { items, total, page, totalPages: Math.ceil(total / limit) }
  }

  // ── 7. Developer projects ─────────────────────────────────────────────────

  async getDeveloperProjects(
    currentUser: UserDocument,
    azureId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<ProjectSummaryDto[]> {
    const matchFilter: FilterQuery<CommitDocument> = {
      authorAzureId: azureId,
    }

    if (from || to) {
      matchFilter.pushedAt = {}
      if (from) {
        const { start } = dayRange(from)
        ;(matchFilter.pushedAt as Record<string, Date>)['$gte'] = start
      }
      if (to) {
        const { end } = dayRange(to)
        ;(matchFilter.pushedAt as Record<string, Date>)['$lte'] = end
      }
    }

    interface ProjectAggRow {
      repositoryId: string
      repositoryName: string
      commitCount: number
      totalLinesAdded: number
      totalLinesRemoved: number
      languagesUsed: string[]
      lastCommitAt: Date
    }

    return this.commitModel.aggregate<ProjectAggRow>([
      { $match: matchFilter },

      {
        $group: {
          _id: '$repositoryId',
          repositoryName: { $first: '$repositoryName' },
          commitCount: { $sum: 1 },
          totalLinesAdded: { $sum: '$totalLinesAdded' },
          totalLinesRemoved: { $sum: '$totalLinesRemoved' },
          // Each commit carries an array of languages — collect all then flatten
          langArrays: { $push: '$languagesUsed' },
          lastCommitAt: { $max: '$pushedAt' },
        },
      },

      // Flatten the array-of-arrays → deduplicated language set
      {
        $addFields: {
          languagesUsed: {
            $reduce: {
              input: '$langArrays',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
        },
      },

      {
        $project: {
          _id: 0,
          repositoryId: '$_id',
          repositoryName: 1,
          commitCount: 1,
          totalLinesAdded: 1,
          totalLinesRemoved: 1,
          languagesUsed: 1,
          lastCommitAt: 1,
        },
      },

      { $sort: { lastCommitAt: -1 } },
    ])
  }

  // ── 7b. Developer PR effort analysis ──────────────────────────────────────

  /**
   * Per-PR "expected vs actual" effort for a developer, over an optional date
   * window. A PR is included only when it had COMMIT ACTIVITY inside the window
   * (not merely created in it) — so an older PR that receives a new commit today
   * appears today, and a PR with no pushes in the window does not. Reads only
   * the precomputed `pr_effort_analysis` projection (single indexed query).
   */
  async getDeveloperPrEffort(
    azureId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<PrEffortDto[]> {
    const filter: FilterQuery<PrEffortAnalysisDocument> = { authorAzureId: azureId }

    if (from || to) {
      // activeDates are YYYY-MM-DD strings; $elemMatch requires the SAME day-key
      // element to satisfy both bounds (exact membership in [from, to]).
      const bounds: Record<string, string> = {}
      if (from) bounds['$gte'] = from
      if (to) bounds['$lte'] = to
      filter.activeDates = { $elemMatch: bounds }
    }

    const rows = await this.prEffortModel.find(filter).sort({ lastCommitAt: -1 }).lean().exec()

    return rows.map((r) => ({
      azurePrId: r.azurePrId,
      prTitle: r.prTitle,
      repositoryName: r.repositoryName,
      projectName: r.projectName,
      workItemIds: r.workItemIds,
      estimatedHours: r.estimatedHours ?? r.estimatedHoursMid ?? 0,
      efficiencyScore: r.efficiencyScore ?? null,
      complexityLevel: r.complexityLevel,
      aiExplanation: r.aiExplanation,
      actualHours: r.actualHours,
      actualSource: r.actualSource,
      variancePercent: r.variancePercent,
      commitCount: r.commitCount ?? 0,
      phase: r.phase,
      prCreatedAt: r.prCreatedAt,
      prMergedAt: r.prMergedAt,
    }))
  }

  /**
   * Commit history for a single pull request, ascending by push time.
   *
   * Commits store the PR's Mongo `_id` (not its Azure id) in `pullRequestId`,
   * so we resolve the PR first, then fetch its commit feed. Returns an empty
   * list when the PR is unknown or has no commits linked yet.
   */
  async getPrCommits(azurePrId: string): Promise<PrCommitDto[]> {
    const pr = await this.pullRequestModel.findOne({ azurePrId }, { _id: 1 }).lean().exec()
    if (!pr) return []

    const prObjectId = (pr._id as unknown as { toString(): string }).toString()
    const commits = await this.commitModel
      .find(
        { pullRequestId: prObjectId },
        {
          azureCommitId: 1,
          message: 1,
          branchName: 1,
          pushedAt: 1,
          totalLinesAdded: 1,
          totalLinesRemoved: 1,
          totalFilesChanged: 1,
          authorName: 1,
        },
      )
      .sort({ pushedAt: 1 })
      .lean()
      .exec()

    return commits.map((c) => ({
      azureCommitId: c.azureCommitId,
      message: c.message,
      branchName: c.branchName,
      pushedAt: c.pushedAt,
      totalLinesAdded: c.totalLinesAdded,
      totalLinesRemoved: c.totalLinesRemoved,
      totalFilesChanged: c.totalFilesChanged,
      authorName: c.authorName,
    }))
  }

  // ── 8. PR alerts (ADMIN / MANAGER) ───────────────────────────────────────

  async getPrAlerts(): Promise<PrWithAuthorDto[]> {
    const prs = await this.pullRequestModel
      .find({
        workItemIds: { $size: 0 },
        status: { $in: [PullRequestStatus.ACTIVE, PullRequestStatus.COMPLETED] },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    if (!prs.length) return []

    const displayNameMap = await this.buildDisplayNameMap(prs.map((pr) => pr.authorAzureId))

    return prs.map((pr) => ({
      id: (pr._id as unknown as { toString(): string }).toString(),
      azurePrId: pr.azurePrId,
      repositoryName: pr.repositoryName,
      projectName: pr.projectName,
      authorAzureId: pr.authorAzureId,
      authorName: displayNameMap.get(pr.authorAzureId),
      title: pr.title,
      status: pr.status,
      isDraft: pr.isDraft,
      workItemIds: pr.workItemIds,
      createdAt: (pr as unknown as { createdAt?: Date }).createdAt,
      mergedAt: pr.mergedAt,
    }))
  }

  // ── 9. Trigger logs (ADMIN) ───────────────────────────────────────────────

  async getTriggerLogs(
    status: string | undefined,
    from: string | undefined,
    to: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<TriggerLogDocument>> {
    const filter: FilterQuery<TriggerLogDocument> = {}

    if (status) filter.processingStatus = status

    if (from || to) {
      filter.createdAt = {}
      if (from) (filter.createdAt as Record<string, Date>)['$gte'] = new Date(from)
      if (to) (filter.createdAt as Record<string, Date>)['$lte'] = new Date(to)
    }

    const [items, total] = await Promise.all([
      this.triggerLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.triggerLogModel.countDocuments(filter),
    ])

    return {
      items: items as unknown as TriggerLogDocument[],
      total,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  // ── 10. Daily login counts (ADMIN) ────────────────────────────────────────

  /**
   * Day-wise login statistics for admin dashboards. Groups LoginEvents by their
   * UTC `date` bucket, returning total logins and distinct user counts per day.
   * Defaults to the trailing 30 days (inclusive) when no range is supplied.
   */
  async getDailyLoginCounts(from?: string, to?: string): Promise<DailyLoginCountDto[]> {
    const toStr = to ?? todayKey()
    const fromStr =
      from ??
      (() => {
        const d = new Date(`${toStr}T00:00:00.000Z`)
        d.setUTCDate(d.getUTCDate() - 29)
        return `${d.getUTCFullYear()}-${PAD(d.getUTCMonth() + 1)}-${PAD(d.getUTCDate())}`
      })()

    const rows = await this.loginEventModel.aggregate<{
      _id: string
      totalLogins: number
      uniqueUsers: number
    }>([
      { $match: { date: { $gte: fromStr, $lte: toStr } } },
      {
        $group: {
          _id: '$date',
          totalLogins: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          totalLogins: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    return rows.map((r) => ({
      date: r._id,
      totalLogins: r.totalLogins,
      uniqueUsers: r.uniqueUsers,
    }))
  }

  /**
   * Individual login events for admin audit. Same default date window as
   * getDailyLoginCounts (trailing 30 days). Newest first.
   */
  async getLoginEvents(from?: string, to?: string): Promise<LoginEventRecordDto[]> {
    const toStr = to ?? todayKey()
    const fromStr =
      from ??
      (() => {
        const d = new Date(`${toStr}T00:00:00.000Z`)
        d.setUTCDate(d.getUTCDate() - 29)
        return `${d.getUTCFullYear()}-${PAD(d.getUTCMonth() + 1)}-${PAD(d.getUTCDate())}`
      })()

    const rows = await this.loginEventModel
      .find({ date: { $gte: fromStr, $lte: toStr } })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return rows.map((r) => ({
      id: (r._id as unknown as { toString(): string }).toString(),
      userId: (r.userId as unknown as { toString(): string }).toString(),
      email: r.email,
      name: r.name,
      role: r.role,
      date: r.date,
      ipAddress: r.ipAddress,
      loggedInAt: (r as unknown as { createdAt: Date }).createdAt,
    }))
  }
}
