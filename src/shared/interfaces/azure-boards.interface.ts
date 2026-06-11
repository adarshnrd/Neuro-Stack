export const AZURE_BOARDS_SERVICE = 'AZURE_BOARDS_SERVICE'

export interface AzureWorkItemData {
  id: number
  type: string
  title: string
  description?: string
  state: string
  assignedToId?: string
  projectName: string
  estimatedHours?: number
  completedHours?: number
  remainingHours?: number
  storyPoints?: number
  sprintName?: string
  sprintPath?: string
  startedAt?: Date
  closedAt?: Date
  createdInAzureAt?: Date
}

export interface IAzureBoardsService {
  getWorkItem(workItemId: number): Promise<AzureWorkItemData>
  getWorkItemsBatch(ids: number[]): Promise<AzureWorkItemData[]>
  getPrLinkedWorkItems(repositoryId: string, prId: number, projectName: string): Promise<number[]>
}
