import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

import { ComplexityLevel } from './ai-analysis.schema'

export type PrEffortAnalysisDocument = HydratedDocument<PrEffortAnalysis>

/** How the developer's actual effort was derived for a PR. */
export enum ActualEffortSource {
  /** Summed from the linked work item(s) CompletedWork field. */
  WORK_ITEM_LOGGED = 'work-item-logged',
  /** Estimated by clustering the PR's commit timestamps into work sessions. */
  COMMIT_ACTIVITY = 'commit-activity',
}

/**
 * `estimate_only` — a code-derived AI estimate exists but no work item is linked,
 * so there is no trustworthy "actual" yet.
 * `complete` — both the AI estimate and a developer-actual are known.
 */
export enum PrEffortPhase {
  ESTIMATE_ONLY = 'estimate_only',
  COMPLETE = 'complete',
}

/**
 * PR-grained effort analysis (the "expected vs actual" verdict for one PR).
 *
 * This is a lean, read-optimized projection: it denormalizes the PR title,
 * author, repo/project and the relevant dates so the developer-facing read is a
 * single indexed query with no joins. It is upserted (keyed by `azurePrId`) by
 * the PR-effort pipeline whenever the PR or a linked work item changes, so the
 * analysis converges as facts arrive (late binding).
 */
@Schema({ timestamps: true })
export class PrEffortAnalysis {
  // ── Identity / display (denormalized) ─────────────────────────────────────
  @Prop({ required: true, unique: true })
  declare azurePrId: string

  @Prop({ required: true })
  declare prTitle: string

  @Prop({ required: true, index: true })
  declare authorAzureId: string

  @Prop({ required: true })
  declare repositoryName: string

  @Prop({ required: true })
  declare projectName: string

  @Prop({ type: [Number], default: [] })
  declare workItemIds: number[]

  // ── AI evaluation (code-aware: net PR diff + work item) ───────────────────
  /** Single headline estimate (hours) of how long the work SHOULD take. */
  @Prop({ type: Number, default: 0 })
  declare estimatedHours: number

  /** AI code-quality / efficiency score (0–100) of the delivered work. */
  @Prop({ type: Number, default: null })
  declare efficiencyScore: number | null

  // Deprecated range fields — retained for back-compat; populated = estimatedHours.
  @Prop({ type: Number, default: 0 })
  declare estimatedHoursMin: number

  @Prop({ type: Number, default: 0 })
  declare estimatedHoursMax: number

  /** Headline expected value used for variance (== estimatedHours). */
  @Prop({ type: Number, default: 0 })
  declare estimatedHoursMid: number

  @Prop({ type: String, enum: ComplexityLevel, default: ComplexityLevel.MEDIUM })
  declare complexityLevel: ComplexityLevel

  @Prop({ type: String, default: '' })
  declare aiExplanation: string

  // ── Developer actual (work-item-derived or commit-activity) ──────────────
  @Prop({ type: Number, default: null })
  declare actualHours: number | null

  @Prop({ type: String, enum: ActualEffortSource, default: null })
  declare actualSource: ActualEffortSource | null

  /** ((actual - estimatedMid) / estimatedMid) * 100; null until both known. */
  @Prop({ type: Number, default: null })
  declare variancePercent: number | null

  // ── Commit activity (drives the period filter) ───────────────────────────
  // Distinct UTC day-keys (YYYY-MM-DD) on which this PR received a commit. A PR
  // appears in a date window only if it has activity within it — so an old PR
  // that gets a new commit today shows up today, and a PR opened with no new
  // pushes does not. Empty when the PR has no commits yet.
  @Prop({ type: [String], default: [] })
  declare activeDates: string[]

  /** Total number of commits pushed to this PR (denormalized from the commit feed). */
  @Prop({ type: Number, default: 0 })
  declare commitCount: number

  /** Timestamp of the most recent commit on this PR (sort key). */
  @Prop({ type: Date })
  lastCommitAt?: Date

  // ── Control ───────────────────────────────────────────────────────────────
  @Prop({ type: String, enum: PrEffortPhase, default: PrEffortPhase.ESTIMATE_ONLY })
  declare phase: PrEffortPhase

  @Prop({ type: Date })
  prCreatedAt?: Date

  @Prop({ type: Date })
  prMergedAt?: Date

  @Prop({ type: Date })
  analyzedAt?: Date

  @Prop({ type: String, default: '' })
  declare modelUsed: string
}

export const PrEffortAnalysisSchema = SchemaFactory.createForClass(PrEffortAnalysis)

// Serves the developer period read: author + commit-activity day membership.
PrEffortAnalysisSchema.index({ authorAzureId: 1, activeDates: 1 })
