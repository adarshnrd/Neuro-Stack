import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { config } from '../config/index.js';
import { changeSetService } from './changeSetService.js';
import { FileChangeStatus } from '../enums/reviewEnum.js';
import { fileExists, resolveInsideRoot } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger('verificationService');

const CHECK_TIMEOUT_MS = 60_000;
const OUTPUT_MAX_CHARS = 6_000;

/**
 * Allowlisted checks. Commands run via execFile (no shell) with arg arrays,
 * cwd locked to a throwaway sandbox. Nothing here is user- or model-supplied.
 * `requires` is a workspace file that must exist for the check to be applicable
 * (skipped otherwise, so a bare workspace isn't reported as failing).
 */
const ALLOWED_CHECKS: Record<string, { cmd: string; args: string[]; requires: string }> = {
  typecheck: { cmd: 'npx', args: ['tsc', '--noEmit'], requires: 'tsconfig.json' },
  test: { cmd: 'npm', args: ['test', '--silent'], requires: 'package.json' },
  lint: { cmd: 'npm', args: ['run', 'lint'], requires: 'package.json' },
};

export function allowedCheckNames(): string[] {
  return Object.keys(ALLOWED_CHECKS);
}

export interface VerificationResult {
  ran: string[];
  allPassed: boolean;
  output: string;
}

/**
 * Runs the requested checks against the changeset's staged files.
 *
 * Staged changes are materialized into a temporary sandbox (a copy of the
 * workspace with node_modules symlinked) so checks see the proposed code
 * WITHOUT writing to the real workspace before human approval. Always includes
 * a syntax check of every changed JS/TS file.
 */
export async function runChecks(changeSetId: string, checks: string[] = []): Promise<VerificationResult> {
  const changeSet = changeSetService.getChangeSet(changeSetId);
  if (!changeSet || changeSet.files.length === 0) {
    return { ran: [], allPassed: true, output: '(no staged changes to verify)' };
  }

  // Only run checks that are both allowlisted and applicable to this workspace
  const workspace = path.resolve(config.workspace.path);
  const applicable: string[] = [];
  for (const name of checks) {
    const check = ALLOWED_CHECKS[name];
    if (check && (await fileExists(path.join(workspace, check.requires)))) {
      applicable.push(name);
    }
  }

  const sandbox = await materializeSandbox(changeSetId);
  const segments: string[] = [];
  let allPassed = true;
  const ran: string[] = [];

  try {
    // Always: syntax-check changed JS/TS files (cheap, no deps needed)
    const syntaxResult = await syntaxCheck(sandbox, changeSet.files);
    if (syntaxResult) {
      ran.push('syntax');
      segments.push(syntaxResult.output);
      allPassed &&= syntaxResult.passed;
    }

    for (const name of applicable) {
      const { cmd, args } = ALLOWED_CHECKS[name];
      const result = await runOne(name, cmd, args, sandbox);
      ran.push(name);
      segments.push(result.output);
      allPassed &&= result.passed;
    }
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }

  return { ran, allPassed, output: segments.join('\n\n').slice(0, OUTPUT_MAX_CHARS) || '(no checks ran)' };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function runOne(
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ passed: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, timeout: CHECK_TIMEOUT_MS });
    return { passed: true, output: `$ ${name}: PASS\n${truncate(stdout + stderr)}` };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const detail = e.killed ? 'timed out' : truncate(`${e.stdout ?? ''}${e.stderr ?? ''}` || e.message || 'failed');
    log.debug('Check failed', { source: 'verificationService#runOne', name });
    return { passed: false, output: `$ ${name}: FAIL\n${detail}` };
  }
}

async function syntaxCheck(
  sandbox: string,
  files: { filePath: string; status: FileChangeStatus }[],
): Promise<{ passed: boolean; output: string } | null> {
  const jsFiles = files
    .filter((f) => f.status !== FileChangeStatus.DELETED && /\.(js|mjs|cjs)$/.test(f.filePath))
    .map((f) => f.filePath);
  if (jsFiles.length === 0) return null;

  const failures: string[] = [];
  for (const rel of jsFiles) {
    try {
      await execFileAsync('node', ['--check', rel], { cwd: sandbox, timeout: 10_000 });
    } catch (error: unknown) {
      const e = error as { stderr?: string; message?: string };
      failures.push(`${rel}: ${truncate(e.stderr ?? e.message ?? 'syntax error', 500)}`);
    }
  }

  return failures.length === 0
    ? { passed: true, output: `$ syntax: PASS (${jsFiles.length} file(s))` }
    : { passed: false, output: `$ syntax: FAIL\n${failures.join('\n')}` };
}

/**
 * Creates a temp sandbox: workspace copied (minus node_modules/.git), staged
 * changes applied, node_modules symlinked back so tooling resolves deps.
 */
async function materializeSandbox(changeSetId: string): Promise<string> {
  const workspace = path.resolve(config.workspace.path);
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'neurostack-verify-'));

  if (await fileExists(workspace)) {
    await fs.cp(workspace, sandbox, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.git`),
    });
    const nodeModules = path.join(workspace, 'node_modules');
    if (await fileExists(nodeModules)) {
      await fs.symlink(nodeModules, path.join(sandbox, 'node_modules'), 'dir').catch(() => { /* optional */ });
    }
  }

  const changeSet = changeSetService.getChangeSet(changeSetId);
  for (const file of changeSet?.files ?? []) {
    const target = resolveInsideRoot(sandbox, file.filePath);
    if (file.status === FileChangeStatus.DELETED) {
      await fs.rm(target, { force: true }).catch(() => { /* ignore */ });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.proposedContent, 'utf-8');
    }
  }

  return sandbox;
}

function truncate(text: string, max: number = OUTPUT_MAX_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n…[truncated]` : trimmed;
}
