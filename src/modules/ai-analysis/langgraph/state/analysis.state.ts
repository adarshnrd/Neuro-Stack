import { Annotation } from '@langchain/langgraph'
import type { CommitDocument } from '@app/database/schemas/commit.schema'
import type { AzureWorkItemData } from '@app/shared/interfaces/azure-boards.interface'

// ── Qwen estimate shape (mirrors AnalysisOutput from json-parser) ───────────

export interface QwenEstimate {
  estimatedEffortHours: number
  /** AI code-quality / efficiency score (0–100); null when not provided. */
  efficiencyScore: number | null
  complexityLevel: string
  hasTests: boolean
  hasDocumentation: boolean
  hasBugFix: boolean
  hasRefactoring: boolean
  isSecurityRelated: boolean
  technicalSummary: string
}

// ── LangGraph Annotation-based state ────────────────────────────────────────

export const AnalysisAnnotation = Annotation.Root({
  /** MongoDB ObjectId string of the commit to analyse */
  commitId: Annotation<string>(),
  /** Loaded Mongoose CommitDocument (null until extractCommitInfo runs) */
  commit: Annotation<CommitDocument | null>(),
  /** Formatted diff summary built from filesChanged, truncated to 5 000 chars */
  diffContent: Annotation<string>(),
  /** Work item fetched from Azure Boards or local DB; null if not found */
  workItem: Annotation<AzureWorkItemData | null>(),
  hasWorkItem: Annotation<boolean>(),
  /** Parsed Qwen model output; null until analyzeWithQwen runs */
  qwenEstimate: Annotation<QwenEstimate | null>(),
  efficiencyScore: Annotation<number>(),
  /** Non-null stops the graph early (routes extractCommitInfo → END) */
  error: Annotation<string | null>(),
  analysisComplete: Annotation<boolean>(),
})

export type AnalysisState = typeof AnalysisAnnotation.State

// ── Initial state factory ────────────────────────────────────────────────────

export function createInitialState(commitId: string): AnalysisState {
  return {
    commitId,
    commit: null,
    diffContent: '',
    workItem: null,
    hasWorkItem: false,
    qwenEstimate: null,
    efficiencyScore: 0,
    error: null,
    analysisComplete: false,
  }
}
