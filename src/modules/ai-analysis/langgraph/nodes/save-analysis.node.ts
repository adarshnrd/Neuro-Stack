import type { Model } from 'mongoose'
import { Types } from 'mongoose'
import type { AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import { ComplexityLevel } from '@app/database/schemas/ai-analysis.schema'
import { CommitAnalysisStatus } from '@app/database/schemas/commit.schema'
import type { CommitDocument } from '@app/database/schemas/commit.schema'
import type { AnalysisState } from '../state/analysis.state'

interface SaveAnalysisDeps {
  analysisModel: Model<AIAnalysisDocument>
  commitModel: Model<CommitDocument>
  modelName: string
}

function toComplexityLevel(raw: string): ComplexityLevel {
  const map: Record<string, ComplexityLevel> = {
    low: ComplexityLevel.LOW,
    medium: ComplexityLevel.MEDIUM,
    high: ComplexityLevel.HIGH,
    'very-high': ComplexityLevel.VERY_HIGH,
  }
  return map[raw.toLowerCase()] ?? ComplexityLevel.MEDIUM
}

/**
 * Node 5 — Persist the AIAnalysis document and mark the commit as complete.
 *
 * Uses findOneAndUpdate+upsert so re-running the graph on the same commit
 * (e.g. after a transient failure) safely overwrites rather than duplicates.
 */
export function createSaveAnalysisNode(deps: SaveAnalysisDeps) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const q = state.qwenEstimate
    if (!state.commit || !q) {
      return {
        error: 'Missing commit or qwenEstimate in saveAnalysis',
        analysisComplete: false,
      }
    }

    const commitObjectId = new Types.ObjectId(state.commitId)

    await deps.analysisModel
      .findOneAndUpdate(
        { commitId: commitObjectId },
        {
          $set: {
            commitId: commitObjectId,
            workItemId: state.workItem?.id ?? null,
            estimatedEffortHours: q.estimatedEffortHours,
            actualEffortHours: null,
            effortDeltaPercent: null,
            efficiencyScore: state.efficiencyScore,
            complexityLevel: toComplexityLevel(q.complexityLevel),
            codeQualitySignals: {
              hasTests: q.hasTests,
              hasDocumentation: q.hasDocumentation,
              hasRefactoring: q.hasRefactoring,
              hasBugFix: q.hasBugFix,
              isSecurityRelated: q.isSecurityRelated,
            },
            technicalSummary: q.technicalSummary,
            modelUsed: deps.modelName,
          },
        },
        { upsert: true, new: false },
      )
      .exec()

    await deps.commitModel
      .findByIdAndUpdate(state.commitId, {
        $set: { analysisStatus: CommitAnalysisStatus.COMPLETE },
      })
      .exec()

    return { analysisComplete: true }
  }
}
