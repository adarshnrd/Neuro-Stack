import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { openWorkspace } from './workspaceService.js';
import { workspaceContext } from './workspaceContext.js';
import { StateStore } from './stateStore.js';
import { taskSpecFromRequirement } from './taskSpecService.js';
import { buildProjectMap, renderProjectMap } from './projectIndexer.js';
import { ProjectMap } from '../types/workspaceTypes.js';
import { runAgentLoop, AgentLoopEvent, AgentLoopResult, HandoffInfo } from '../llm/agentLoop.js';
import { invokeForRole, isExhaustionError } from '../llm/llmService.js';
import { ALL_FILE_TOOLS } from '../tools/fileTools.js';
import { runCommandTool } from '../tools/shellTools.js';
import { WorkspaceWriteMode, PermissionMode, ModelRole } from '../enums/index.js';
import { ApprovalBroker, WorkspaceSession } from '../types/workspaceTypes.js';
import { OnboardingPacket, RunStatus } from '../types/stateStoreTypes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('folderAgentService');

export interface FolderProgress {
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface FolderAgentOptions {
  permissionMode?: PermissionMode;
  approvalBroker?: ApprovalBroker;
  maxToolRounds?: number;
  /** Back up files before overwrite/delete (default true). */
  snapshots?: boolean;
  /** Live progress callback (e.g. to stream over SSE). */
  onProgress?: (event: FolderProgress) => void;
}

export interface FolderAgentRunResult {
  content: string;
  rounds: number;
  toolCallCount: number;
  hitRoundCap: boolean;
  handoffCount: number;
  status: RunStatus;
  stateDir: string;
  resumed: boolean;
}

function baseSystemPrompt(rootDir: string, projectMap?: ProjectMap): string {
  return [
    'You are NeuroStack operating as an autonomous coding agent inside a real project folder.',
    `Working directory: ${rootDir}`,
    '',
    'Tools (all scoped to this folder):',
    '- `list_directory`, `read_file` to explore.',
    '- `write_file`, `delete_file` — these APPLY DIRECTLY to the folder.',
    '- `run_command` to run shell commands (install deps, build, run tests, etc.).',
    '',
    'Work autonomously in a loop: plan → change files → run builds/tests → read output → fix →',
    're-run, until the task is genuinely complete. Do NOT ask for step-by-step confirmation. Read',
    'files before changing them; write complete file contents. When done, summarize what changed',
    'and the final build/test state.',
    ...(projectMap ? ['', renderProjectMap(projectMap)] : []),
  ].join('\n');
}

/** Builds the project map (or reuses the cached one) so every run/handoff starts situationally aware. */
async function ensureProjectMap(rootDir: string, store: StateStore, refresh: boolean): Promise<ProjectMap> {
  if (!refresh) {
    const cached = await store.readProjectMap();
    if (cached) return cached;
  }
  const map = await buildProjectMap(rootDir);
  await store.writeProjectMap(map);
  return map;
}

/**
 * PLANNER decomposes the requirement into concrete, checkable subtasks. These
 * become the tracked acceptance criteria (plan.json) — giving progress
 * granularity and a precise remaining-work list on resume. Falls back to a
 * single criterion if planning fails or returns nothing.
 */
async function decomposeTask(requirement: string, projectMap: ProjectMap): Promise<{ text: string; done: boolean }[]> {
  try {
    const raw = await invokeForRole(ModelRole.PLANNER, [
      new SystemMessage(
        'Decompose the coding task into 2–8 concrete, independently checkable subtasks (acceptance ' +
          'criteria). Respond with ONLY a JSON array of short imperative strings — no prose, no markdown.',
      ),
      new HumanMessage(`Project stack: ${projectMap.detectedStack.join(', ')}\n\nTask:\n${requirement}`),
    ]);
    const items = extractJsonArray(raw)
      .map((t) => String(t).trim())
      .filter(Boolean);
    if (items.length > 0) return items.map((text) => ({ text, done: false }));
  } catch (error: unknown) {
    log.warn('Task decomposition failed — using single criterion', {
      source: 'folderAgentService#decomposeTask',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return taskSpecFromRequirement(requirement).criteria;
}

/** VALIDATOR marks which subtasks the finished work satisfies (best-effort). */
async function markCompletedCriteria(store: StateStore, result: FolderAgentRunResult | AgentLoopResult): Promise<void> {
  const plan = await store.readPlan();
  if (!plan || plan.criteria.length === 0) return;
  try {
    const raw = await invokeForRole(ModelRole.VALIDATOR, [
      new SystemMessage(
        'Given the acceptance criteria and the agent\'s final report, return ONLY a JSON array of the ' +
          'exact criterion strings that are now fully satisfied. Return [] if none.',
      ),
      new HumanMessage(`Criteria:\n${plan.criteria.map((c) => `- ${c.text}`).join('\n')}\n\nFinal report:\n${result.content}`),
    ]);
    const done = extractJsonArray(raw).map((t) => String(t).trim());
    if (done.length > 0) await store.markCriteriaDone(done);
  } catch { /* best effort — leave criteria as-is */ }
}

function renderTaskWithCriteria(requirement: string, criteria: { text: string }[]): string {
  return [
    requirement,
    '',
    'Address every acceptance criterion:',
    ...criteria.map((c) => `- [ ] ${c.text}`),
  ].join('\n');
}

function extractJsonArray(raw: string): unknown[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Starts a fresh autonomous folder-agent run with durable state tracking.
 * Every run initializes/uses `<folder>/.neurostack/` as its state store so the
 * run is resumable after a crash, exit, or model exhaustion.
 */
export async function runFolderAgent(
  rootDir: string,
  requirement: string,
  options: FolderAgentOptions = {},
): Promise<FolderAgentRunResult> {
  const store = new StateStore(rootDir);
  await store.acquireLock();

  try {
    const projectMap = await ensureProjectMap(rootDir, store, true);
    const criteria = await decomposeTask(requirement, projectMap);
    const state = await store.init(requirement, criteria);
    await store.appendProgress({ type: 'start', message: `Run started (${criteria.length} subtask(s)): ${firstLine(requirement)}` });

    const session = await buildSession(rootDir, store, state.runId, options);
    const messages = [
      new SystemMessage(baseSystemPrompt(rootDir, projectMap)),
      new HumanMessage(renderTaskWithCriteria(requirement, criteria)),
    ];

    const result = await drive(session, store, messages, options, requirement, false);
    return result;
  } finally {
    await store.releaseLock();
  }
}

/**
 * Resumes an interrupted run from `<folder>/.neurostack/`. Reconstructs a
 * compact, model-portable onboarding packet (spec + pending work + rolling
 * summary + open issues) and re-enters the loop — no transcript replay needed.
 */
export async function resumeFolderAgent(
  rootDir: string,
  options: FolderAgentOptions = {},
): Promise<FolderAgentRunResult> {
  const store = new StateStore(rootDir);
  if (!(await store.exists())) {
    throw new Error('No .neurostack state found in this folder — nothing to resume.');
  }

  const priorState = await store.readState();
  if (priorState?.status === RunStatus.COMPLETE) {
    return {
      content: 'Run already complete — nothing to resume.',
      rounds: 0,
      toolCallCount: 0,
      hitRoundCap: false,
      handoffCount: 0,
      status: RunStatus.COMPLETE,
      stateDir: store.dir,
      resumed: true,
    };
  }

  await store.acquireLock();
  try {
    const packet = await store.buildOnboardingPacket();
    await store.updateState({ status: RunStatus.RUNNING });
    await store.appendProgress({ type: 'resume', message: `Resumed at iteration ${packet.priorIterations}` });

    const projectMap = await ensureProjectMap(rootDir, store, true);
    const session = await buildSession(rootDir, store, priorState?.runId ?? 'resume', options);
    const messages = [
      new SystemMessage(`${baseSystemPrompt(rootDir, projectMap)}\n\nYou are RESUMING an in-progress task from a prior session (possibly a different model). First re-scan the actual folder to confirm current state, then continue the remaining work.`),
      new HumanMessage(renderOnboarding(packet)),
    ];

    return await drive(session, store, messages, options, packet.requirement, true);
  } finally {
    await store.releaseLock();
  }
}

/** Reads the persisted status for the CLI `status` command. */
export async function getFolderStatus(rootDir: string): Promise<string> {
  const store = new StateStore(rootDir);
  if (!(await store.exists())) return 'No NeuroStack run found in this folder.';

  const state = await store.readState();
  const plan = await store.readPlan();
  const done = plan?.criteria.filter((c) => c.done).length ?? 0;
  const total = plan?.criteria.length ?? 0;
  const summary = await store.readSummary();

  return [
    `Status:     ${state?.status ?? 'unknown'}`,
    `Iterations: ${state?.iterations ?? 0}`,
    `Criteria:   ${done}/${total} done`,
    `Updated:    ${state?.updatedAt ?? '—'}`,
    '',
    '── Context summary ──',
    summary.trim() || '(none)',
  ].join('\n');
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function buildSession(
  rootDir: string,
  store: StateStore,
  runId: string,
  options: FolderAgentOptions,
): Promise<WorkspaceSession> {
  return openWorkspace(rootDir, {
    writeMode: WorkspaceWriteMode.DIRECT,
    permissionMode: options.permissionMode ?? PermissionMode.AUTO,
    approvalBroker: options.approvalBroker,
  }).then((session) => ({
    ...session,
    onSnapshot:
      options.snapshots === false
        ? undefined
        : (relPath: string, absPath: string) => store.snapshotFile(relPath, absPath, runId),
  }));
}

async function drive(
  session: WorkspaceSession,
  store: StateStore,
  messages: (HumanMessage | SystemMessage)[],
  options: FolderAgentOptions,
  requirement: string,
  resumed: boolean,
): Promise<FolderAgentRunResult> {
  const tools = [...ALL_FILE_TOOLS, runCommandTool];

  const emit = (event: FolderProgress): void => options.onProgress?.(event);

  const onEvent = async (e: AgentLoopEvent): Promise<void> => {
    const message = `Round ${e.round}: ${e.toolCalls.map((t) => t.name).join(', ') || 'no tools'}`;
    await store.appendProgress({ type: 'round', model: 'coder', message, data: { toolCalls: e.toolCalls.map((t) => t.name) } });
    await store.updateState({ iterations: e.round });
    emit({ type: 'round', message, data: { round: e.round } });
  };

  // Cross-model handoff: record it durably so the switch is auditable and the
  // resumed state reflects which model is now doing the work.
  let handoffs = 0;
  const onHandoff = async (info: HandoffInfo): Promise<void> => {
    handoffs++;
    const message = `Model handoff: ${info.fromProvider} → ${info.toProvider} (round ${info.round})`;
    await store.appendProgress({ type: 'handoff', model: info.toProvider, message, data: { reason: info.reason } });
    await store.appendDecision(`Handed off ${info.fromProvider} → ${info.toProvider} at round ${info.round}: ${firstLine(info.reason)}`);
    await store.updateState({ currentModel: info.toProvider });
    emit({ type: 'handoff', message });
  };

  try {
    const result = await workspaceContext.run(session, () =>
      runAgentLoop(messages, tools, { onEvent, onHandoff, maxToolRounds: options.maxToolRounds }),
    );

    await markCompletedCriteria(store, result);
    await finalizeSummary(store, requirement, result);
    await store.updateState({ status: RunStatus.COMPLETE });
    await store.appendProgress({ type: 'done', message: `Run complete (${result.handoffCount} handoff(s))` });
    emit({ type: 'done', message: `Run complete (${result.handoffCount} handoff(s))` });

    return { ...result, status: RunStatus.COMPLETE, stateDir: store.dir, resumed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Every provider exhausted → PAUSE (resumable later), not a hard failure.
    const paused = isExhaustionError(error);
    const status = paused ? RunStatus.PAUSED : RunStatus.FAILED;

    log.error('Folder agent run stopped', { source: 'folderAgentService#drive', status, error: message });
    await store.appendProgress({ type: paused ? 'paused' : 'error', message });
    emit({ type: paused ? 'paused' : 'error', message });
    await store.appendOpenIssue(
      paused
        ? `All configured models are exhausted (rate/quota limits). Run 'resume' later to continue: ${firstLine(message)}`
        : `Run failed: ${message}`,
    );
    await finalizeSummary(store, requirement, null).catch(() => { /* best effort */ });
    await store.updateState({ status });

    if (paused) {
      return {
        content: `All models are currently exhausted. Progress saved — run resume later to continue.\n\n${message}`,
        rounds: 0,
        toolCallCount: 0,
        hitRoundCap: false,
        handoffCount: handoffs,
        status: RunStatus.PAUSED,
        stateDir: store.dir,
        resumed,
      };
    }
    throw error;
  }
}

/** Regenerates the compact, model-portable context summary via the SUMMARIZER role. */
async function finalizeSummary(store: StateStore, requirement: string, result: AgentLoopResult | null): Promise<void> {
  const events = await store.readProgress();
  const logText = events.slice(-40).map((e) => `- ${e.type}: ${e.message}`).join('\n');

  try {
    const summary = await invokeForRole(ModelRole.SUMMARIZER, [
      new SystemMessage(
        'You maintain a compact, model-portable "state of the world" for an autonomous coding task. ' +
          'Given the goal and the progress log, write a concise summary: what is DONE, what is IN PROGRESS, ' +
          'what REMAINS, and any gotchas the next session (possibly a different AI model) must know. ' +
          'Keep it tight — it will be re-ingested to continue the work.',
      ),
      new HumanMessage(
        `Goal:\n${requirement}\n\nProgress log:\n${logText}\n\n${result ? `Final agent message:\n${result.content}` : 'The run was interrupted before completion.'}`,
      ),
    ]);
    await store.writeSummary(`# Context Summary\n\n${summary}\n`);
  } catch (error: unknown) {
    log.warn('Summary generation failed', { source: 'folderAgentService#finalizeSummary', error: error instanceof Error ? error.message : String(error) });
    await store.writeSummary(`# Context Summary\n\n(Automatic summary unavailable)\n\nGoal: ${requirement}\n\nRecent activity:\n${logText}\n`);
  }
}

function renderOnboarding(packet: OnboardingPacket): string {
  return [
    'RESUME — continue this task from where the previous session left off.',
    '',
    `## Goal\n${packet.requirement}`,
    '',
    `## Already done (${packet.doneCriteria.length})`,
    packet.doneCriteria.map((c) => `- [x] ${c}`).join('\n') || '(none recorded)',
    '',
    `## Remaining (${packet.pendingCriteria.length})`,
    packet.pendingCriteria.map((c) => `- [ ] ${c}`).join('\n') || '(none recorded)',
    '',
    `## Context summary\n${packet.summary || '(none)'}`,
    '',
    `## Open issues\n${packet.openIssues || '(none)'}`,
    '',
    `## Prior decisions\n${packet.decisions || '(none)'}`,
    '',
    'Re-scan the actual folder to confirm real state, then complete the remaining work.',
  ].join('\n');
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim()) ?? '').slice(0, 120);
}
