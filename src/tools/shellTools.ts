import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { getWorkspaceSession } from '../services/workspaceContext.js';
import { classifyCommand, needsApproval } from '../services/commandPolicy.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('shellTools');

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_MAX_CHARS = 12_000;

interface ShellResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

/**
 * Runs a shell command scoped to the active folder-agent workspace.
 *
 * Permission model:
 * - Requires an active workspace session (folder-agent mode); refuses otherwise.
 * - cwd is locked to the session's rootDir.
 * - The command is classified; whether it needs approval depends on the
 *   permission mode (AUTO: only high-risk; MANUAL: everything). When approval
 *   is required, the session's broker is consulted — no broker means the
 *   command is not run and the agent is told approval is needed.
 */
export const runCommandTool = tool(
  async ({ command }) => {
    const session = getWorkspaceSession();
    if (!session) {
      return 'run_command is only available in a folder-agent session. No active workspace.';
    }

    const { risk, reason } = classifyCommand(command);
    log.info('Tool requested: Run Command', {
      source: 'shellTools#runCommandTool',
      command,
      risk,
      mode: session.permissionMode,
    });

    if (needsApproval(risk, session.permissionMode)) {
      if (!session.approvalBroker) {
        return `Command requires approval (${reason}) but no approver is available. Not run: \`${command}\``;
      }
      const approved = await session.approvalBroker({ kind: 'command', command, risk, reason });
      if (!approved) {
        log.info('Command denied by user', { source: 'shellTools#runCommandTool', command });
        return `User denied the command: \`${command}\`. Do not retry it; choose another approach.`;
      }
    }

    const result = await runShell(command, session.rootDir);
    log.info('Command finished', {
      source: 'shellTools#runCommandTool',
      command,
      code: result.code,
      timedOut: result.timedOut,
    });

    const status = result.timedOut ? 'TIMED OUT' : `exit ${result.code}`;
    return `$ ${command}\n[${status}]\n${result.output || '(no output)'}`;
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the project folder (install deps, build, run tests, etc.) and get ' +
      'its combined stdout/stderr and exit code. Runs in the workspace root. Use this to verify ' +
      'your work and iterate on failures. High-risk commands may require user approval.',
    schema: z.object({
      command: z.string().describe('The shell command to run, e.g. "npm test"'),
    }),
  },
);

/** Executes a command in its own process group so the whole tree is killed on timeout. */
function runShell(command: string, cwd: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, detached: true });
    let output = '';
    let timedOut = false;

    const capture = (chunk: Buffer) => {
      if (output.length < OUTPUT_MAX_CHARS) output += chunk.toString();
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }, timeoutMs);

    const finish = (code: number | null) => {
      clearTimeout(timer);
      const trimmed =
        output.length > OUTPUT_MAX_CHARS
          ? `${output.slice(0, OUTPUT_MAX_CHARS)}\n…[truncated ${output.length - OUTPUT_MAX_CHARS} chars]`
          : output;
      resolve({ code, output: trimmed.trim(), timedOut });
    };

    child.on('close', finish);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: `Failed to start command: ${err.message}`, timedOut });
    });
  });
}
