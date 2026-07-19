export type FileChangeType = 'add' | 'modify' | 'delete' | 'rename'

export type PRStatus = 'active' | 'completed' | 'abandoned' | 'draft'

export interface ChangedFile {
  filePath: string
  linesAdded: number
  linesRemoved: number
  changeType: FileChangeType
  language: string
}

export interface AIAnalysisData {
  efficiencyScore: number
  complexityLevel: 'low' | 'medium' | 'high' | 'very-high'
  technicalSummary: string
  estimatedEffortHours: number
}

export interface CommitRecord {
  id: string
  azureCommitId: string
  repositoryId: string
  repositoryName: string
  projectName: string
  authorAzureId: string
  authorName: string
  message: string
  branchName: string
  pushedAt: string
  totalLinesAdded: number
  totalLinesRemoved: number
  totalFilesChanged: number
  languagesUsed: string[]
  filesChanged?: ChangedFile[]
  analysis: AIAnalysisData | null
  prStatus: PRStatus | null
}
