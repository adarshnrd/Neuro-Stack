import { config } from '../../config/index.js';
import { CommandArgs, CommandResult } from '../../types/commandTypes.js';
import { findSessionById } from '../../database/sessionRepository.js';
import { findUserById } from '../../database/userRepository.js';
import { UserRole } from '../../enums/authEnum.js';

/**
 * Gate for PR-affecting commands (@PR_REVIEW, @PR_APPROVE, @MERGE_PR). These
 * act on the single shared GitHub repo with no per-PR ownership tracked in
 * our data model, so — mirroring the ADMIN-only gating already used for
 * equivalent sensitive actions elsewhere in the app (e.g. organizations and
 * user-management routes) — only an ADMIN-role user may run them. Resolves
 * the caller's role via the session that issued the command. Returns a
 * failed CommandResult when the caller isn't an admin, otherwise null.
 */
export async function requireAdmin(sessionId: string): Promise<CommandResult | null> {
  const session = await findSessionById(sessionId);
  const user = session ? await findUserById(session.userId) : null;

  if (!user || user.role !== UserRole.ADMIN) {
    return {
      success: false,
      message: 'This command requires admin privileges.',
    };
  }
  return null;
}

/**
 * Gate for all git/PR operations. Returns a failed CommandResult naming the
 * missing environment variables when GitHub is not configured (owner, repo, and
 * an auth method), otherwise null. Until configured, git work is disabled.
 */
export function requireGitHubConfig(): CommandResult | null {
  const { owner, repo, token, authMode, appId } = config.github;
  const hasAuth = authMode === 'app' ? !!appId : !!token;

  const missing: string[] = [];
  if (!owner) missing.push('GITHUB_OWNER');
  if (!repo) missing.push('GITHUB_REPO');
  if (!hasAuth) missing.push('GITHUB_TOKEN (or the GitHub App variables)');

  if (missing.length > 0) {
    return {
      success: false,
      message: [
        '## ⚠️ Git configuration is missing',
        '',
        'Git and pull-request operations are disabled until GitHub is configured in `.env`.',
        `Missing: ${missing.map((m) => `\`${m}\``).join(', ')}.`,
      ].join('\n'),
    };
  }
  return null;
}

/** Reads and validates a required PR number from parsed command args. */
export function readPrNumber(args: CommandArgs): number | null {
  const raw = args.prNumber;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** Standard "missing PR number" failure result. */
export function missingPrNumberResult(command: string): CommandResult {
  return {
    success: false,
    message: `Please include a PR number, e.g. \`@${command} #42\`.`,
  };
}

/** Wraps any thrown value into a user-friendly failed CommandResult. */
export function toErrorResult(action: string, error: unknown): CommandResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    message: `## ❌ ${action} failed\n\n> ${message}`,
  };
}

/** Filesystem-safe slug from free text, for branch names. */
export function branchSlug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'changes';
}
