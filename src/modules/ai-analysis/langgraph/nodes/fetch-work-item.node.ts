import type { Model } from 'mongoose'
import type { WorkItemDocument } from '@app/database/schemas/work-item.schema'
import type {
  IAzureBoardsService,
  AzureWorkItemData,
} from '@app/shared/interfaces/azure-boards.interface'
import type { AnalysisState } from '../state/analysis.state'

interface FetchWorkItemDeps {
  workItemModel: Model<WorkItemDocument>
  boardsService?: IAzureBoardsService
}

/**
 * Node 2 — Fetch work item context for the commit.
 *
 * Priority:
 *   1. Azure Boards API (if AzureBoardsService is wired in)
 *   2. Local MongoDB WorkItem document as fallback
 *   3. hasWorkItem:false when no linked work item exists
 */
export function createFetchWorkItemNode(deps: FetchWorkItemDeps) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const workItemIds = state.commit?.workItemIds ?? []
    if (!workItemIds.length) {
      return { hasWorkItem: false }
    }

    const workItemId = workItemIds[0]

    // ── Try Azure Boards API first ─────────────────────────────────────────
    if (deps.boardsService) {
      try {
        const wi = await deps.boardsService.getWorkItem(workItemId)
        return { workItem: wi, hasWorkItem: true }
      } catch {
        // Fall through to local DB
      }
    }

    // ── Fallback: local WorkItem collection ────────────────────────────────
    const doc = await deps.workItemModel.findOne({ azureWorkItemId: workItemId }).exec()

    if (!doc) return { hasWorkItem: false }

    const wi: AzureWorkItemData = {
      id: doc.azureWorkItemId,
      type: doc.type as string,
      title: doc.title,
      state: doc.state,
      assignedToId: doc.assignedToAzureId,
      projectName: doc.projectName,
      estimatedHours: doc.estimatedHours,
      completedHours: doc.completedHours,
      remainingHours: doc.remainingHours,
      storyPoints: doc.storyPoints,
      sprintName: doc.sprintName,
      sprintPath: doc.sprintPath,
      startedAt: doc.startedAt,
      closedAt: doc.closedAt,
    }
    return { workItem: wi, hasWorkItem: true }
  }
}
