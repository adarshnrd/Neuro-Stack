import { CommandArgs, CommandHandler, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { MergeMethod } from '../../enums/gitEnum.js';
import { GitHubService } from '../../services/githubService.js';
import { createChildLogger } from '../../logger/index.js';
import { MERGE_PR_COMMAND_DESCRIPTION } from '../../constants/commandConstants.js';
import { missingPrNumberResult, readPrNumber, requireGitHubConfig, toErrorResult } from './prHandlerUtil.js';

const log = createChildLogger('mergePrHandler');

/**
 * Handles `@MERGE_PR #<n> [--method squash|rebase|merge]`.
 *
 * Governance: PRs are never auto-merged elsewhere — running this explicit
 * command IS the deliberate human action. The PR is verified to be open and
 * mergeable before the merge is attempted.
 */
export class MergePrHandler implements CommandHandler {
  public readonly name: CommandName = CommandName.MERGE_PR;
  public readonly description: string = MERGE_PR_COMMAND_DESCRIPTION;

  // Lazy service construction after the config guard (see CreatePrHandler).
  public constructor(private readonly githubOverride?: GitHubService) {}

  public async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    const configError = requireGitHubConfig();
    if (configError) return configError;

    const prNumber = readPrNumber(args);
    if (!prNumber) return missingPrNumberResult('MERGE_PR');

    const method = this.resolveMethod(args.method);
    if (!method) {
      return {
        success: false,
        message: `Invalid merge method. Use one of: ${Object.values(MergeMethod).join(', ')}.`,
      };
    }

    const github = this.githubOverride ?? new GitHubService();
    log.info('Executing MERGE_PR handler', { source: 'mergePrHandler#execute', sessionId, prNumber, method });

    try {
      const pr = await github.getPullRequest(prNumber);
      if (pr.state !== 'open') {
        return { success: false, message: `PR #${prNumber} is ${pr.state}, not open — nothing to merge.` };
      }
      if (pr.merged) {
        return { success: false, message: `PR #${prNumber} is already merged.` };
      }
      if (pr.mergeable === false) {
        return { success: false, message: `PR #${prNumber} has conflicts and cannot be merged. Resolve them first.` };
      }

      await github.mergePullRequest(prNumber, method);
      return {
        success: true,
        message: `## ✅ Merged PR #${prNumber}\n\n**Method:** ${method}\n**Branch:** \`${pr.head?.ref}\` → \`${pr.base?.ref}\``,
        data: { prNumber, method },
      };
    } catch (error: unknown) {
      log.error('MERGE_PR failed', {
        source: 'mergePrHandler#execute',
        error: error instanceof Error ? error.message : String(error),
      });
      return toErrorResult('PR merge', error);
    }
  }

  private resolveMethod(raw: unknown): MergeMethod | null {
    if (raw === undefined) return MergeMethod.MERGE; // default
    const value = String(raw).toLowerCase();
    return (Object.values(MergeMethod) as string[]).includes(value) ? (value as MergeMethod) : null;
  }
}
