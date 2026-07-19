import { Logger } from '@nestjs/common'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AIMessage } from '@langchain/core/messages'
import type { IAzureGitService } from '@app/shared/interfaces/azure-git.interface'
import { effortEstimationPrompt } from '../../langchain/prompts/effort-estimation.prompt'
import { PromptAssembler } from '../../langchain/prompts/prompt-assembler'
import { parseAIResponse } from '../../langchain/json-parser'
import type { AnalysisState } from '../state/analysis.state'

interface AnalyzeWithQwenDeps {
  llm: BaseChatModel
  gitService?: IAzureGitService
}

const logger = new Logger('AnalyzeWithQwenNode')
// Set AI_DEBUG=true to log the exact AI input/response for traceability.
const AI_DEBUG = process.env.AI_DEBUG === 'true'

/**
 * Node 3 — Invoke the Qwen/LLM model to estimate effort and classify the commit.
 *
 * Uses LCEL: effortEstimationPrompt.pipe(llm)
 * Parses the model's JSON output with the 3-attempt JSON parser.
 */
export function createAnalyzeWithQwenNode(deps: AnalyzeWithQwenDeps) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    if (!state.commit) {
      return { error: 'No commit in state for Qwen analysis' }
    }

    // Fetch the real commit patch (code) so the AI evaluates actual changes.
    let codeDiff = '(code diff unavailable)'
    if (deps.gitService) {
      const built = await deps.gitService.getCommitPatch(
        state.commit.repositoryId,
        state.commit.azureCommitId,
        state.commit.projectName,
      )
      if (built.patch) {
        codeDiff = built.truncated
          ? `${built.patch}\n\n(… diff truncated: ${built.filesIncluded}/${built.filesTotal} files …)`
          : built.patch
      }
    }

    const promptVars = PromptAssembler.buildEffortPrompt(
      state.commit,
      state.workItem, // AzureWorkItemData satisfies WorkItemForPrompt
      codeDiff,
    )

    const commitId = state.commit._id?.toString?.() ?? state.commitId
    if (AI_DEBUG) {
      logger.debug(
        `[AI/commit] ${commitId} input=${JSON.stringify({
          commitMessage: promptVars.commitMessage.slice(0, 200),
          filesChanged: promptVars.filesChanged.slice(0, 300),
          totalLinesAdded: promptVars.totalLinesAdded,
          totalLinesRemoved: promptVars.totalLinesRemoved,
          languagesUsed: promptVars.languagesUsed,
          codeDiff: `${codeDiff.length} chars`,
          workItemTitle: promptVars.workItemTitle,
          workItemEstimatedHours: promptVars.workItemEstimatedHours,
        })}`,
      )
    }

    const chain = effortEstimationPrompt.pipe(deps.llm)
    const response = (await chain.invoke(promptVars)) as AIMessage

    const rawContent =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

    if (AI_DEBUG) {
      logger.debug(`[AI/commit] ${commitId} raw response: ${rawContent.slice(0, 1000)}`)
    }

    const parsed = parseAIResponse(rawContent)

    if (AI_DEBUG) {
      logger.debug(
        `[AI/commit] ${commitId} parsed: ${JSON.stringify({
          estimatedEffortHours: parsed.estimatedEffortHours,
          complexityLevel: parsed.complexityLevel,
          parseError: parsed._parseError ?? false,
        })}`,
      )
    }

    return {
      qwenEstimate: {
        estimatedEffortHours: parsed.estimatedEffortHours,
        efficiencyScore: parsed.efficiencyScore,
        complexityLevel: parsed.complexityLevel as string,
        hasTests: parsed.hasTests,
        hasDocumentation: parsed.hasDocumentation,
        hasBugFix: parsed.hasBugFix,
        hasRefactoring: parsed.hasRefactoring,
        isSecurityRelated: parsed.isSecurityRelated,
        technicalSummary: parsed.technicalSummary,
      },
    }
  }
}
