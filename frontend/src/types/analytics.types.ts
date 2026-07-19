export interface DailySummary {
  developerAzureId: string
  /** YYYY-MM-DD */
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

export interface MonthlySummary {
  developerAzureId: string
  /** YYYY-MM */
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

/** Per-developer PR effort rollup for one day (org daily summary chart). */
export interface OrgDailyEffort {
  developerAzureId: string
  displayName?: string
  estimatedHours: number
  reportedHours: number
  avgEfficiencyScore: number | null
  variancePercent: number | null
  prCount: number
  measuredPrCount: number
}

export interface OrgOverview {
  date: string
  totalCommitsToday: number
  totalCommitsThisWeek: number
  activeDevelopersToday: number
  totalLinesAddedToday: number
  orgAvgEfficiencyScore: number | null
  topPerformers: DailySummary[]
  missingWorkItemPrCount: number
}

export interface ProjectStats {
  repositoryId: string
  repositoryName: string
  commitCount: number
  totalLinesAdded: number
  totalLinesRemoved: number
  languagesUsed: string[]
  lastCommitAt: string
}

export interface PrAlert {
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
  createdAt?: string
  mergedAt?: string
}

export interface PrEffort {
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
  actualSource: 'work-item-logged' | 'commit-activity' | null
  variancePercent: number | null
  /** Total number of commits pushed to this PR. */
  commitCount: number
  /** 'estimate_only' = no work item linked yet; 'complete' = both sides known */
  phase: 'estimate_only' | 'complete'
  prCreatedAt?: string
  prMergedAt?: string
}

/** One commit pushed to a pull request, for the PR commit-history timeline. */
export interface PrCommit {
  azureCommitId: string
  message: string
  branchName: string
  pushedAt: string
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  authorName: string
}
