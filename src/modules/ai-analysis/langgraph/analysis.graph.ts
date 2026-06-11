import { StateGraph, START, END } from '@langchain/langgraph'
import type { Model } from 'mongoose'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

import type { CommitDocument } from '@app/database/schemas/commit.schema'
import type { AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import type { WorkItemDocument } from '@app/database/schemas/work-item.schema'
import type { IAzureBoardsService } from '@app/shared/interfaces/azure-boards.interface'
import type { IAzureGitService } from '@app/shared/interfaces/azure-git.interface'

import { AnalysisAnnotation, type AnalysisState } from './state/analysis.state'
import { createExtractCommitInfoNode } from './nodes/extract-commit-info.node'
import { createFetchWorkItemNode } from './nodes/fetch-work-item.node'
import { createAnalyzeWithQwenNode } from './nodes/analyze-with-qwen.node'
import { calculateScoreNode } from './nodes/calculate-score.node'
import { createSaveAnalysisNode } from './nodes/save-analysis.node'

export interface AnalysisGraphDeps {
  commitModel: Model<CommitDocument>
  analysisModel: Model<AIAnalysisDocument>
  workItemModel: Model<WorkItemDocument>
  llm: BaseChatModel
  modelName: string
  boardsService?: IAzureBoardsService
  gitService?: IAzureGitService
}

// Minimal interface covering the compiled graph's public surface — avoids
// referencing internal LangGraph dist types that cannot be named (TS 2883).
export interface CompiledAnalysisGraph {
  invoke(input: Partial<AnalysisState>, config?: Record<string, unknown>): Promise<AnalysisState>
}

/**
 * Build and compile the commit-analysis LangGraph.
 *
 * Flow:
 *   START → extractCommitInfo
 *     ├─ error or already complete → END
 *     └─ ok → fetchWorkItem → analyzeWithQwen
 *                               ├─ error → END
 *                               └─ ok → calculateScore → saveAnalysis → END
 */
export function buildAnalysisGraph(deps: AnalysisGraphDeps): CompiledAnalysisGraph {
  const workflow = new StateGraph(AnalysisAnnotation)

  workflow
    // ── Nodes ────────────────────────────────────────────────────────────────
    .addNode(
      'extractCommitInfo',
      createExtractCommitInfoNode({
        commitModel: deps.commitModel,
        analysisModel: deps.analysisModel,
      }),
    )
    .addNode(
      'fetchWorkItem',
      createFetchWorkItemNode({
        workItemModel: deps.workItemModel,
        boardsService: deps.boardsService,
      }),
    )
    .addNode(
      'analyzeWithQwen',
      createAnalyzeWithQwenNode({ llm: deps.llm, gitService: deps.gitService }),
    )
    .addNode('calculateScore', calculateScoreNode)
    .addNode(
      'saveAnalysis',
      createSaveAnalysisNode({
        analysisModel: deps.analysisModel,
        commitModel: deps.commitModel,
        modelName: deps.modelName,
      }),
    )
    // ── Edges ────────────────────────────────────────────────────────────────
    .addEdge(START, 'extractCommitInfo')
    .addConditionalEdges('extractCommitInfo', (state: AnalysisState): string => {
      if (state.error != null) return END
      if (state.analysisComplete) return END
      return 'fetchWorkItem'
    })
    .addEdge('fetchWorkItem', 'analyzeWithQwen')
    .addConditionalEdges('analyzeWithQwen', (state: AnalysisState): string =>
      state.error != null ? END : 'calculateScore',
    )
    .addEdge('calculateScore', 'saveAnalysis')
    .addEdge('saveAnalysis', END)

  return workflow.compile() as unknown as CompiledAnalysisGraph
}
