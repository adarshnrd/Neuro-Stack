// Portal roles only. Developers are not portal users and never authenticate.
export type UserRole = 'admin' | 'manager'

export interface DeveloperProfile {
  id: string
  azureDevOpsId?: string
  displayName?: string
  email: string
  role: UserRole
  team?: string
  avatarUrl?: string
  isWhitelisted: boolean
  lastLoginAt?: string
}

export interface DeveloperStats {
  developerAzureId: string
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
