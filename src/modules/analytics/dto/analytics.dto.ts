import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

// ── Regex validators ─────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

// ── Query DTOs ────────────────────────────────────────────────────────────────

export class OrgOverviewQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date?: string
}

export class OrgDailyQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date?: string
}

export class OrgMonthlyQueryDto {
  @IsOptional()
  @Matches(MONTH_RE, { message: 'month must be YYYY-MM' })
  month?: string
}

export class DeveloperDailyQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string

  @IsOptional()
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

export class DeveloperMonthlyQueryDto {
  @IsOptional()
  @Matches(MONTH_RE, { message: 'from must be YYYY-MM' })
  from?: string

  @IsOptional()
  @Matches(MONTH_RE, { message: 'to must be YYYY-MM' })
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

export class DeveloperCommitsQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date?: string

  @IsOptional()
  @IsString()
  repositoryId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

export class DeveloperProjectsQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string

  @IsOptional()
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string
}

export class DeveloperPrEffortQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string

  @IsOptional()
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string
}

export class DailyLoginsQueryDto {
  @IsOptional()
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string

  @IsOptional()
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string
}

export class TriggerLogQueryDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

// ── Response interfaces ───────────────────────────────────────────────────────

export interface AnalysisSummaryDto {
  efficiencyScore: number
  complexityLevel: string
  technicalSummary: string
  estimatedEffortHours: number
}

export interface DailySummaryWithUserDto {
  developerAzureId: string
  date: string
  displayName?: string
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

export interface MonthlySummaryWithUserDto {
  developerAzureId: string
  month: string
  displayName?: string
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

export interface OrgOverviewDto {
  date: string
  totalCommitsToday: number
  totalCommitsThisWeek: number
  activeDevelopersToday: number
  totalLinesAddedToday: number
  orgAvgEfficiencyScore: number | null
  topPerformers: DailySummaryWithUserDto[]
  missingWorkItemPrCount: number
}

export interface CommitWithAnalysisDto {
  id: string
  azureCommitId: string
  repositoryId: string
  repositoryName: string
  projectName: string
  authorAzureId: string
  authorName: string
  message: string
  branchName: string
  pushedAt: Date
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  languagesUsed: string[]
  analysis: AnalysisSummaryDto | null
  prStatus: string | null
}

export interface ProjectSummaryDto {
  repositoryId: string
  repositoryName: string
  commitCount: number
  totalLinesAdded: number
  totalLinesRemoved: number
  languagesUsed: string[]
  lastCommitAt: Date
}

export interface DailyLoginCountDto {
  date: string
  totalLogins: number
  uniqueUsers: number
}

/** Individual successful login record for admin audit views. */
export interface LoginEventRecordDto {
  id: string
  userId: string
  email: string
  name: string
  role: string
  /** UTC YYYY-MM-DD bucket */
  date: string
  ipAddress?: string
  loggedInAt: Date
}

export interface PrWithAuthorDto {
  id: string
  azurePrId: string
  repositoryName: string
  projectName: string
  authorAzureId: string
  authorName?: string
  title: string
  status: string
  isDraft: boolean
  workItemIds: number[]
  createdAt?: Date
  mergedAt?: Date
}

/** Per-developer PR effort rollup for one day (org daily summary chart). */
export interface OrgDailyEffortDto {
  developerAzureId: string
  displayName?: string
  /** Sum of AI-estimated hours across PRs active on this day. */
  estimatedHours: number
  /** Sum of developer-reported (actual) hours across PRs with measured effort. */
  reportedHours: number
  /** Mean PR code-quality efficiency score (0–100); null when unavailable. */
  avgEfficiencyScore: number | null
  /** ((reported - estimated) / estimated) * 100; null when estimated is zero. */
  variancePercent: number | null
  /** Total PRs with commit activity on this day. */
  prCount: number
  /** PRs with a non-null actualHours value. */
  measuredPrCount: number
}

export interface PrEffortDto {
  azurePrId: string
  prTitle: string
  repositoryName: string
  projectName: string
  workItemIds: number[]
  /** Single AI estimate (hours) of how long the work should take. */
  estimatedHours: number
  /** AI code-quality / efficiency score (0–100); null when unavailable. */
  efficiencyScore: number | null
  complexityLevel: string
  aiExplanation: string
  actualHours: number | null
  actualSource: string | null
  variancePercent: number | null
  /** Total number of commits pushed to this PR. */
  commitCount: number
  /** 'estimate_only' = no work item linked yet; 'complete' = both sides known */
  phase: string
  prCreatedAt?: Date
  prMergedAt?: Date
}

/** One commit pushed to a pull request, for the PR commit-history timeline. */
export interface PrCommitDto {
  azureCommitId: string
  message: string
  branchName: string
  pushedAt: Date
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  authorName: string
}
