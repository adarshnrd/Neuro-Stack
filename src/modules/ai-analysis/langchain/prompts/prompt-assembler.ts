import type { CommitDocument } from '@app/database/schemas/commit.schema'
import type { EffortPromptVariables } from './effort-estimation.prompt'

// Minimal structural interface satisfied by both WorkItemDocument and AzureWorkItemData
export interface WorkItemForPrompt {
  title?: string
  description?: string
  estimatedHours?: number | null
}

const DIFF_SUMMARY_MAX = 5000
const NOT_PROVIDED = 'Not provided'

function buildDiffSummary(commit: CommitDocument): string {
  if (!commit.filesChanged?.length) return 'No file changes recorded'

  const lines = commit.filesChanged.map((f) => {
    const change =
      f.linesAdded > 0 || f.linesRemoved > 0 ? ` (+${f.linesAdded}/-${f.linesRemoved})` : ''
    return `${f.changeType.toUpperCase()} ${f.filePath}${change} [${f.language}]`
  })

  const summary = lines.join('\n')
  return summary.length > DIFF_SUMMARY_MAX
    ? summary.slice(0, DIFF_SUMMARY_MAX) + '\n... (truncated)'
    : summary
}

export class PromptAssembler {
  static buildEffortPrompt(
    commit: CommitDocument,
    workItem: WorkItemForPrompt | null,
    codeDiff?: string,
  ): EffortPromptVariables {
    const filesChangedText =
      commit.filesChanged?.length > 0
        ? commit.filesChanged.map((f) => `${f.changeType} ${f.filePath} (${f.language})`).join(', ')
        : 'No files recorded'

    return {
      commitMessage: commit.message || '(no commit message)',
      filesChanged: filesChangedText,
      totalLinesAdded: String(commit.totalLinesAdded ?? 0),
      totalLinesRemoved: String(commit.totalLinesRemoved ?? 0),
      languagesUsed: commit.languagesUsed?.join(', ') || 'unknown',
      diffSummary: buildDiffSummary(commit),
      codeDiff: codeDiff && codeDiff.trim().length > 0 ? codeDiff : '(code diff unavailable)',
      workItemTitle: workItem?.title ?? NOT_PROVIDED,
      workItemDescription: workItem?.description?.trim() || NOT_PROVIDED,
      workItemEstimatedHours:
        workItem?.estimatedHours != null ? String(workItem.estimatedHours) : NOT_PROVIDED,
    }
  }
}
