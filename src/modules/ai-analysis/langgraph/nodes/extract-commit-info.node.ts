import type { Model } from 'mongoose'
import type { CommitDocument } from '@app/database/schemas/commit.schema'
import type { AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import { Types } from 'mongoose'
import type { AnalysisState } from '../state/analysis.state'

interface ExtractDeps {
  commitModel: Model<CommitDocument>
  analysisModel: Model<AIAnalysisDocument>
}

const DIFF_SUMMARY_MAX = 5000

function buildDiffContent(commit: CommitDocument): string {
  if (!commit.filesChanged?.length) return 'No file changes recorded'

  const lines = commit.filesChanged.map((f) => {
    const lineDelta =
      f.linesAdded > 0 || f.linesRemoved > 0 ? ` (+${f.linesAdded}/-${f.linesRemoved})` : ''
    return `${f.changeType.toUpperCase()} ${f.filePath}${lineDelta} [${f.language}]`
  })

  const summary = lines.join('\n')
  return summary.length > DIFF_SUMMARY_MAX
    ? summary.slice(0, DIFF_SUMMARY_MAX) + '\n... (truncated)'
    : summary
}

/**
 * Node 1 — Load and validate the commit.
 *
 * Also performs the idempotency check: if an AIAnalysis already exists for
 * this commit, sets analysisComplete=true so the graph short-circuits at the
 * conditional edge and routes straight to END.
 */
export function createExtractCommitInfoNode(deps: ExtractDeps) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    // Idempotency — skip the expensive LLM call if analysis already stored
    const commitObjectId = new Types.ObjectId(state.commitId)
    const existing = await deps.analysisModel.exists({ commitId: commitObjectId }).exec()
    if (existing) {
      return { analysisComplete: true }
    }

    // Equivalent to CommitsService.findById(state.commitId)
    const commit = await deps.commitModel.findById(state.commitId).exec()
    if (!commit) {
      return { error: 'Commit not found' }
    }

    return {
      commit,
      diffContent: buildDiffContent(commit),
    }
  }
}
