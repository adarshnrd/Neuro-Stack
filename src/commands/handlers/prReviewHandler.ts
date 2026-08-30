import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { CommandArgs, CommandHandler, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { ModelRole } from '../../enums/llmEnum.js';
import { GitHubService } from '../../services/githubService.js';
import { invokeForRole } from '../../llm/llmService.js';
import { createChildLogger } from '../../logger/index.js';
import { PR_REVIEW_COMMAND_DESCRIPTION } from '../../constants/commandConstants.js';
import {
  missingPrNumberResult,
  readPrNumber,
  requireAdmin,
  requireGitHubConfig,
  toErrorResult,
} from './prHandlerUtil.js';

const log = createChildLogger('prReviewHandler');

const DIFF_MAX_CHARS = 24_000;

/**
 * Handles `@PR_REVIEW #<n>`.
 *
 * Fetches the PR diff from GitHub and returns an AI code review (via the
 * REVIEWER role). The review is returned to the user — it is not auto-posted,
 * preserving human-in-the-loop control.
 */
export class PrReviewHandler implements CommandHandler {
  public readonly name: CommandName = CommandName.PR_REVIEW;
  public readonly description: string = PR_REVIEW_COMMAND_DESCRIPTION;

  // Lazy service construction after the config guard (see CreatePrHandler).
  public constructor(private readonly githubOverride?: GitHubService) {}

  public async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    const configError = requireGitHubConfig();
    if (configError) return configError;

    const authError = await requireAdmin(sessionId);
    if (authError) return authError;

    const prNumber = readPrNumber(args);
    if (!prNumber) return missingPrNumberResult('PR_REVIEW');

    const github = this.githubOverride ?? new GitHubService();
    log.info('Executing PR_REVIEW handler', { source: 'prReviewHandler#execute', sessionId, prNumber });

    try {
      const diff = await github.getPullRequestDiff(prNumber);
      if (!diff.trim()) {
        return { success: true, message: `PR #${prNumber} has no diff to review.` };
      }

      const truncated = diff.length > DIFF_MAX_CHARS ? `${diff.slice(0, DIFF_MAX_CHARS)}\n…[diff truncated]` : diff;
      const review = await invokeForRole(ModelRole.REVIEWER, [
        new SystemMessage(
          'You are a senior code reviewer. Review the pull request diff below. Return concise Markdown with: ' +
            'a one-line summary, then Issues (critical/warning/info with file:line where possible), then ' +
            'Recommendations. Be specific and actionable.',
        ),
        new HumanMessage(`Pull request #${prNumber} diff:\n\n\`\`\`diff\n${truncated}\n\`\`\``),
      ]);

      return {
        success: true,
        message: `## 🔍 Review of PR #${prNumber}\n\n${review}`,
        data: { prNumber },
      };
    } catch (error: unknown) {
      log.error('PR_REVIEW failed', {
        source: 'prReviewHandler#execute',
        error: error instanceof Error ? error.message : String(error),
      });
      return toErrorResult('PR review', error);
    }
  }
}
