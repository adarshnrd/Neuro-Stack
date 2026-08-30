import { CommandArgs, CommandHandler, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { ReviewEvent } from '../../enums/gitEnum.js';
import { GitHubService } from '../../services/githubService.js';
import { createChildLogger } from '../../logger/index.js';
import { PR_APPROVE_COMMAND_DESCRIPTION } from '../../constants/commandConstants.js';
import {
  missingPrNumberResult,
  readPrNumber,
  requireAdmin,
  requireGitHubConfig,
  toErrorResult,
} from './prHandlerUtil.js';

const log = createChildLogger('prApproveHandler');

/**
 * Handles `@PR_APPROVE #<n>` — submits an approving review on GitHub.
 */
export class PrApproveHandler implements CommandHandler {
  public readonly name: CommandName = CommandName.PR_APPROVE;
  public readonly description: string = PR_APPROVE_COMMAND_DESCRIPTION;

  // Lazy service construction after the config guard (see CreatePrHandler).
  public constructor(private readonly githubOverride?: GitHubService) {}

  public async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    const configError = requireGitHubConfig();
    if (configError) return configError;

    const authError = await requireAdmin(sessionId);
    if (authError) return authError;

    const prNumber = readPrNumber(args);
    if (!prNumber) return missingPrNumberResult('PR_APPROVE');

    const github = this.githubOverride ?? new GitHubService();
    const note = ((args.requirement as string | undefined) ?? '').trim();
    log.info('Executing PR_APPROVE handler', { source: 'prApproveHandler#execute', sessionId, prNumber });

    try {
      await github.submitReview(prNumber, note || 'Approved via NeuroStack.', ReviewEvent.APPROVE);
      return {
        success: true,
        message: `## ✅ Approved PR #${prNumber}\n\nSubmit the merge with \`@MERGE_PR #${prNumber}\` when ready.`,
        data: { prNumber },
      };
    } catch (error: unknown) {
      log.error('PR_APPROVE failed', {
        source: 'prApproveHandler#execute',
        error: error instanceof Error ? error.message : String(error),
      });
      return toErrorResult('PR approval', error);
    }
  }
}
