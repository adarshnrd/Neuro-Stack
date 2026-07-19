import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AIMessage } from '@langchain/core/messages'
import { AZURE_GIT_SERVICE, IAzureGitService } from '@app/shared/interfaces/azure-git.interface'
import { dayKey } from '@app/shared/helpers/timezone.helper'

import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { PullRequest, PullRequestDocument } from '@app/database/schemas/pull-request.schema'
import { WorkItem, WorkItemDocument } from '@app/database/schemas/work-item.schema'
import {
  ActualEffortSource,
  PrEffortAnalysis,
  PrEffortAnalysisDocument,
  PrEffortPhase,
} from '@app/database/schemas/pr-effort-analysis.schema'
import { ComplexityLevel } from '@app/database/schemas/ai-analysis.schema'
import { QWEN_LLM } from '@app/modules/ai-analysis/langchain/qwen.provider'
import { prEffortEstimationPrompt } from '@app/modules/ai-analysis/langchain/prompts/pr-effort-estimation.prompt'

// ── Tunable constants (single source of truth) ───────────────────────────────

/** Gap (minutes) above which two consecutive commits are treated as separate
 *  work sessions — the idle/overnight stretch between them is NOT counted. */
const SESSION_GAP_MINUTES = 120
/** Credit (minutes) for work done before the first commit of each session. */
const LEAD_IN_MINUTES = 30
/** Sanity cap so a pathological PR can never report an absurd actual. */
const MAX_PR_HOURS = 40

// ── AI output shape ──────────────────────────────────────────────────────────

interface PrEstimate {
  /** Single headline estimate (hours) of how long the work should take. */
  estimatedHours: number
  /** AI code-quality / efficiency score (0–100) of the delivered work. */
  efficiencyScore: number | null
  complexityLevel: ComplexityLevel
  explanation: string
}

const VALID_COMPLEXITY = new Set<string>(Object.values(ComplexityLevel))

/** Aggregated code stats for a PR, summed across all its commits. */
interface PrCommitStats {
  commitCount: number
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  languages: string[]
  /** Commit push timestamps, ascending — feeds the session algorithm. */
  timestamps: Date[]
  /** Distinct UTC day-keys (YYYY-MM-DD) the PR received commits on. */
  activeDates: string[]
  /** Most recent commit time, or null when the PR has no commits. */
  lastCommitAt: Date | null
}

@Injectable()
export class PrEffortService {
  private readonly logger = new Logger(PrEffortService.name)
  private readonly modelName: string
  // Set AI_DEBUG=true to log the exact AI input/response for traceability.
  private readonly aiDebug = process.env.AI_DEBUG === 'true'

  constructor(
    @InjectModel(PullRequest.name)
    private readonly pullRequestModel: Model<PullRequestDocument>,
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
    @InjectModel(WorkItem.name)
    private readonly workItemModel: Model<WorkItemDocument>,
    @InjectModel(PrEffortAnalysis.name)
    private readonly effortModel: Model<PrEffortAnalysisDocument>,
    @Inject(QWEN_LLM)
    private readonly llm: BaseChatModel,
    @Optional()
    @Inject(AZURE_GIT_SERVICE)
    private readonly azureGitService?: IAzureGitService,
  ) {
    const llmAny = this.llm as unknown as Record<string, unknown>
    this.modelName =
      (typeof llmAny['modelName'] === 'string' ? llmAny['modelName'] : null) ??
      (typeof llmAny['model'] === 'string' ? llmAny['model'] : null) ??
      'unknown'
  }

  // ── Entry points ───────────────────────────────────────────────────────────

  /**
   * Compute (or refresh) the effort analysis for one PR and upsert it.
   * The AI estimate is computed once and reused on subsequent calls (it is
   * code-derived and stable); only the actual/variance/phase are recomputed —
   * which is what makes late-binding (work item tagged later) cheap.
   */
  async computeForPr(azurePrId: string): Promise<void> {
    const pr = await this.pullRequestModel.findOne({ azurePrId }).exec()
    if (!pr) {
      this.logger.debug(`PR ${azurePrId} not found — skipping effort analysis`)
      return
    }

    const existing = await this.effortModel.findOne({ azurePrId }).exec()
    const stats = await this.aggregateCommitStats(pr)

    // ── 1. AI evaluation (code-aware) ────────────────────────────────────────
    // Reuse the existing AI verdict unless the commit set changed (new code to
    // evaluate). This keeps cost bounded across the many PR/work-item events
    // while still re-evaluating when the developer actually pushes more code.
    let estimate: PrEstimate
    const codeUnchanged =
      !!existing && existing.estimatedHours > 0 && existing.commitCount === stats.commitCount
    if (codeUnchanged) {
      estimate = {
        estimatedHours: existing!.estimatedHours,
        efficiencyScore: existing!.efficiencyScore ?? null,
        complexityLevel: existing!.complexityLevel,
        explanation: existing!.aiExplanation,
      }
    } else {
      estimate = await this.estimateWithAi(pr, stats)
    }
    const estimatedHours = Math.round(estimate.estimatedHours * 100) / 100

    // ── 2. Developer actual (work-item-logged → commit-activity) ─────────────
    const { actualHours, actualSource } = await this.computeActual(pr, stats)

    // ── 3. Variance + phase ──────────────────────────────────────────────────
    const variancePercent =
      actualHours != null && estimatedHours > 0
        ? Math.round(((actualHours - estimatedHours) / estimatedHours) * 100)
        : null
    const phase = pr.workItemIds.length > 0 ? PrEffortPhase.COMPLETE : PrEffortPhase.ESTIMATE_ONLY

    const createdAt = (pr as unknown as { createdAt?: Date }).createdAt

    // A PR's creation day always counts as activity, so a PR opened today shows
    // in today's view even before its commits are (re)linked. Merged with the
    // commit-derived activity days.
    const activeDates = new Set(stats.activeDates)
    if (createdAt) activeDates.add(dayKey(createdAt))
    const activeDatesSorted = [...activeDates].sort()
    const lastCommitAt =
      stats.lastCommitAt && (!createdAt || stats.lastCommitAt > createdAt)
        ? stats.lastCommitAt
        : (createdAt ?? stats.lastCommitAt)

    await this.effortModel
      .updateOne(
        { azurePrId },
        {
          $set: {
            azurePrId,
            prTitle: pr.title,
            authorAzureId: pr.authorAzureId,
            repositoryName: pr.repositoryName,
            projectName: pr.projectName,
            workItemIds: pr.workItemIds,
            estimatedHours,
            efficiencyScore: estimate.efficiencyScore,
            // Back-compat: keep the legacy range fields populated to the single value.
            estimatedHoursMin: estimatedHours,
            estimatedHoursMax: estimatedHours,
            estimatedHoursMid: estimatedHours,
            complexityLevel: estimate.complexityLevel,
            aiExplanation: estimate.explanation,
            actualHours,
            actualSource,
            variancePercent,
            phase,
            commitCount: stats.commitCount,
            activeDates: activeDatesSorted,
            lastCommitAt,
            prCreatedAt: createdAt,
            prMergedAt: pr.mergedAt,
            analyzedAt: new Date(),
            modelUsed: this.modelName,
          },
        },
        { upsert: true },
      )
      .exec()

    this.logger.debug(
      `PR #${azurePrId} effort: est ${estimatedHours}h, efficiency ${estimate.efficiencyScore ?? 'n/a'}, ` +
        `actual ${actualHours ?? 'n/a'}h (${actualSource ?? 'pending'}), phase=${phase}`,
    )
  }

  /** Recompute every PR linked to a work item — late-binding entry point. */
  async recomputeForWorkItem(workItemId: number): Promise<void> {
    const prs = await this.pullRequestModel
      .find({ workItemIds: workItemId }, { azurePrId: 1 })
      .exec()
    for (const pr of prs) {
      await this.computeForPr(pr.azurePrId)
    }
  }

  // ── Commit aggregation ─────────────────────────────────────────────────────

  private async aggregateCommitStats(pr: PullRequestDocument): Promise<PrCommitStats> {
    const commits = await this.commitModel
      .find(
        { pullRequestId: pr._id.toString() },
        {
          pushedAt: 1,
          totalLinesAdded: 1,
          totalLinesRemoved: 1,
          totalFilesChanged: 1,
          languagesUsed: 1,
        },
      )
      .sort({ pushedAt: 1 })
      .lean()
      .exec()

    const languages = new Set<string>()
    const dates = new Set<string>()
    let totalLinesAdded = 0
    let totalLinesRemoved = 0
    let totalFilesChanged = 0
    const timestamps: Date[] = []

    for (const c of commits) {
      totalLinesAdded += c.totalLinesAdded ?? 0
      totalLinesRemoved += c.totalLinesRemoved ?? 0
      totalFilesChanged += c.totalFilesChanged ?? 0
      for (const l of c.languagesUsed ?? []) languages.add(l)
      if (c.pushedAt) {
        const ts = new Date(c.pushedAt)
        timestamps.push(ts)
        dates.add(dayKey(ts))
      }
    }

    return {
      commitCount: commits.length,
      totalLinesAdded,
      totalLinesRemoved,
      totalFilesChanged,
      languages: [...languages],
      timestamps,
      activeDates: [...dates].sort(),
      lastCommitAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
    }
  }

  // ── AI estimate ────────────────────────────────────────────────────────────

  private async estimateWithAi(pr: PullRequestDocument, stats: PrCommitStats): Promise<PrEstimate> {
    const workItemContext = await this.buildWorkItemContext(pr.workItemIds)

    // Pull the PR's NET code diff (real code) so the AI evaluates the actual work.
    let codeDiff = '(code diff unavailable)'
    if (this.azureGitService) {
      const built = await this.azureGitService.getPullRequestNetDiff(
        pr.repositoryId,
        Number(pr.azurePrId),
        pr.projectName,
      )
      if (built.patch) {
        codeDiff = built.truncated
          ? `${built.patch}\n\n(… diff truncated: showing ${built.filesIncluded}/${built.filesTotal} files …)`
          : built.patch
      }
    }

    const promptInput = {
      prTitle: pr.title || '(none)',
      prDescription: pr.description || '(none)',
      commitCount: String(stats.commitCount),
      filesChanged: String(stats.totalFilesChanged),
      totalLinesAdded: String(stats.totalLinesAdded),
      totalLinesRemoved: String(stats.totalLinesRemoved),
      languagesUsed: stats.languages.join(', ') || '(unknown)',
      workItemContext,
      codeDiff,
    }

    if (this.aiDebug) {
      this.logger.debug(
        `[AI/pr-effort] PR #${pr.azurePrId} model=${this.modelName} input=${JSON.stringify({
          ...promptInput,
          prDescription: promptInput.prDescription.slice(0, 200),
          workItemContext: promptInput.workItemContext.slice(0, 300),
          codeDiff: `${codeDiff.length} chars`,
        })}`,
      )
      if (codeDiff === '(code diff unavailable)') {
        this.logger.warn(
          `[AI/pr-effort] PR #${pr.azurePrId} has NO code diff to evaluate — ` +
            'check the Azure Git connection / PR has commits.',
        )
      }
    }

    try {
      const chain = prEffortEstimationPrompt.pipe(this.llm)
      const response = (await chain.invoke(promptInput)) as AIMessage

      const raw =
        typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

      if (this.aiDebug) {
        this.logger.debug(`[AI/pr-effort] PR #${pr.azurePrId} raw response: ${raw.slice(0, 1000)}`)
      }

      const parsed = this.parseEstimate(raw, stats)
      if (this.aiDebug) {
        this.logger.debug(`[AI/pr-effort] PR #${pr.azurePrId} parsed: ${JSON.stringify(parsed)}`)
      }
      return parsed
    } catch (err) {
      this.logger.warn(
        `AI estimate failed for PR #${pr.azurePrId}, using heuristic: ${err instanceof Error ? err.message : String(err)}`,
      )
      return this.heuristicEstimate(stats)
    }
  }

  private async buildWorkItemContext(workItemIds: number[]): Promise<string> {
    if (!workItemIds.length) return '(no work item linked yet)'
    const items = await this.workItemModel
      .find(
        { azureWorkItemId: { $in: workItemIds } },
        { title: 1, description: 1, estimatedHours: 1 },
      )
      .lean()
      .exec()
    if (!items.length) return '(no work item linked yet)'
    return items
      .map((wi) => {
        const desc = wi.description ? ` — ${wi.description.slice(0, 400)}` : ''
        const est = wi.estimatedHours != null ? ` [team estimate: ${wi.estimatedHours}h]` : ''
        return `• ${wi.title}${est}${desc}`
      })
      .join('\n')
  }

  /** Parse the LLM JSON; fall back to a heuristic on any failure. */
  private parseEstimate(raw: string, stats: PrCommitStats): PrEstimate {
    let obj: Record<string, unknown> | null = null
    try {
      obj = JSON.parse(raw) as Record<string, unknown>
    } catch {
      const match = /\{[\s\S]*\}/.exec(raw)
      if (match) {
        try {
          obj = JSON.parse(match[0]) as Record<string, unknown>
        } catch {
          obj = null
        }
      }
    }
    if (!obj) return this.heuristicEstimate(stats)

    const hours = Math.max(0, Number(obj.estimatedHours) || 0)
    if (hours === 0) return this.heuristicEstimate(stats)

    const complexityRaw = String(obj.complexityLevel ?? '').toLowerCase()
    const rawScore = Number(obj.efficiencyScore)
    const efficiencyScore = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : null

    return {
      estimatedHours: Math.round(hours * 100) / 100,
      efficiencyScore,
      complexityLevel: VALID_COMPLEXITY.has(complexityRaw)
        ? (complexityRaw as ComplexityLevel)
        : ComplexityLevel.MEDIUM,
      explanation: String(obj.explanation ?? '').slice(0, 280) || 'AI evaluation.',
    }
  }

  /** Crude size-based fallback when the model is unavailable/unparseable. */
  private heuristicEstimate(stats: PrCommitStats): PrEstimate {
    const churn = stats.totalLinesAdded + stats.totalLinesRemoved
    // ~80 lines of churn per hour as a baseline, floored at 15 minutes.
    const hours = Math.round(Math.max(0.25, churn / 80) * 100) / 100
    const complexity =
      churn > 800
        ? ComplexityLevel.VERY_HIGH
        : churn > 300
          ? ComplexityLevel.HIGH
          : churn > 80
            ? ComplexityLevel.MEDIUM
            : ComplexityLevel.LOW
    return {
      estimatedHours: hours,
      efficiencyScore: null, // no code-quality verdict without the model
      complexityLevel: complexity,
      explanation: `Heuristic estimate from ${churn} lines of churn across ${stats.commitCount} commit(s).`,
    }
  }

  // ── Developer actual ───────────────────────────────────────────────────────

  private async computeActual(
    pr: PullRequestDocument,
    stats: PrCommitStats,
  ): Promise<{ actualHours: number | null; actualSource: ActualEffortSource | null }> {
    // No work item linked yet → no trustworthy actual (late-binding state).
    if (pr.workItemIds.length === 0) {
      return { actualHours: null, actualSource: null }
    }

    // 1. Use the work item's tracked effort — the time the developer reports
    //    against the task is treated as the actual hours. Per linked work item,
    //    take the most concrete field available: Completed Work (logged) →
    //    Remaining Work → Original Estimate. Teams that only maintain Remaining
    //    Work still get a value, and the figure tracks edits on the work item.
    const items = await this.workItemModel
      .find(
        { azureWorkItemId: { $in: pr.workItemIds } },
        { completedHours: 1, remainingHours: 1, estimatedHours: 1 },
      )
      .lean()
      .exec()
    const tracked = items.reduce(
      (sum, wi) => sum + (wi.completedHours || wi.remainingHours || wi.estimatedHours || 0),
      0,
    )
    if (tracked > 0) {
      return {
        actualHours: Math.round(tracked * 100) / 100,
        actualSource: ActualEffortSource.WORK_ITEM_LOGGED,
      }
    }

    // 2. Fall back to commit-session active time (excludes idle/overnight gaps).
    const sessionHours = estimateActiveHoursFromCommits(stats.timestamps)
    if (sessionHours != null) {
      return { actualHours: sessionHours, actualSource: ActualEffortSource.COMMIT_ACTIVITY }
    }

    return { actualHours: null, actualSource: null }
  }
}

// ── Commit-session active-time estimator ─────────────────────────────────────

/**
 * Estimate the hours actually spent by clustering commit timestamps into work
 * sessions. A gap larger than SESSION_GAP_MINUTES closes the current session
 * (that idle/overnight stretch is excluded). Each session also gets a fixed
 * lead-in credit for work done before its first commit.
 *
 * Example: a commit at 19:00 and the next at 11:00 next day (16h gap) → two
 * single-commit sessions → 0 + 30min×2 ≈ 1h, not 16h.
 */
export function estimateActiveHoursFromCommits(timestamps: Date[]): number | null {
  if (!timestamps.length) return null

  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime())
  const gapMs = SESSION_GAP_MINUTES * 60_000

  let activeMs = 0
  let sessionCount = 1
  let sessionStart = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur.getTime() - prev.getTime() <= gapMs) {
      // same session — continue
    } else {
      activeMs += prev.getTime() - sessionStart.getTime()
      sessionCount++
      sessionStart = cur
    }
    prev = cur
  }
  activeMs += prev.getTime() - sessionStart.getTime()

  const totalMinutes = activeMs / 60_000 + LEAD_IN_MINUTES * sessionCount
  const hours = Math.min(totalMinutes / 60, MAX_PR_HOURS)
  return Math.round(hours * 100) / 100
}
