import { CommandRisk, PermissionMode } from '../enums/workspaceEnum.js';

export interface CommandClassification {
  risk: CommandRisk;
  reason: string;
}

/**
 * Patterns for genuinely dangerous / irreversible / system-affecting commands.
 * A match forces approval even in AUTO mode. This is deliberately narrow — it
 * targets catastrophe, not ordinary dev commands — so autonomy stays the norm.
 */
const HIGH_RISK_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)\b/i, reason: 'recursive force delete (rm -rf)' },
  { re: /\brm\s+-[a-z]*\s*(\/|~|\$HOME)(\s|$)/i, reason: 'delete targeting root or home' },
  { re: /\b(dd|mkfs|fdisk|parted|shred|wipefs)\b/i, reason: 'disk / low-level device operation' },
  { re: /\bsudo\b|\bsu\b\s/i, reason: 'privilege escalation' },
  { re: />\s*\/dev\/(sd|nvme|disk|null|zero)?/i, reason: 'writing to a device file' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'power / shutdown command' },
  { re: /\bkillall\b|\bkill\s+-9\b/i, reason: 'force-killing processes' },
  { re: /\bchmod\s+-R?\s*777\b|\bchmod\s+777\b/i, reason: 'world-writable permissions' },
  { re: /\bchown\s+-R\b/i, reason: 'recursive ownership change' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: 'piping a remote script into a shell' },
  { re: /\bgit\s+push\b.*(--force|-f)\b/i, reason: 'force push' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i, reason: 'destructive git working-tree reset/clean' },
  { re: /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, reason: 'fork bomb' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b/i, reason: 'publishing a package' },
  { re: /\b(npm|yarn|pnpm)\b[^\n]*\s(-g|--global)\b/i, reason: 'global package install (affects system)' },
];

/**
 * Classifies a shell command's risk. Pure and side-effect free.
 */
export function classifyCommand(command: string): CommandClassification {
  const trimmed = command.trim();
  for (const { re, reason } of HIGH_RISK_PATTERNS) {
    if (re.test(trimmed)) {
      return { risk: CommandRisk.HIGH, reason };
    }
  }
  return { risk: CommandRisk.NORMAL, reason: 'ordinary command' };
}

/**
 * Decides whether a command needs explicit user approval before running.
 *
 * - MANUAL mode: every command requires approval.
 * - AUTO mode: only high-risk commands require approval; normal commands run.
 */
export function needsApproval(risk: CommandRisk, mode: PermissionMode): boolean {
  if (mode === PermissionMode.MANUAL) return true;
  return risk === CommandRisk.HIGH;
}
