import { Command } from '@langchain/langgraph';
import { buildLoopGraph } from '../graph/loopWorkflow.js';
import { LoopStateType } from '../graph/loopState.js';
import { changeSetService } from './changeSetService.js';
import { updateCriteriaStatus } from './taskSpecService.js';
import {
  LoopProgressEvent,
  LoopRunResult,
  LoopStopReason,
  TaskSpec,
} from '../types/agentTaskTypes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('agentLoopService');

const DEFAULT_MAX_ITERATIONS = 6;

export interface RunOptions {
  sessionId: string;
  autoApprove?: boolean;
  maxIterations?: number;
  verificationEnabled?: boolean;
}

interface ActiveRun {
  threadId: string;
  spec: TaskSpec;
  changeSetId: string;
}

// One compiled graph (with its MemorySaver) shared across runs; each run is a
// distinct thread_id. Pending runs awaiting approval are tracked for resume.
const graph = buildLoopGraph();
const pendingRuns = new Map<string, ActiveRun>();

/**
 * Starts an agent-loop run, yielding progress events as nodes execute.
 *
 * If autoApprove is false the generator stops after emitting an
 * `awaiting_approval` event; call {@link resumeRun} with the decision. On a
 * completed run the generator's return value is the {@link LoopRunResult}.
 */
export async function* startRun(
  spec: TaskSpec,
  options: RunOptions,
): AsyncGenerator<LoopProgressEvent, LoopRunResult> {
  const threadId = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const changeSet = await changeSetService.createChangeSet(options.sessionId);

  const initialState: Partial<LoopStateType> = {
    taskSpec: spec,
    sessionId: options.sessionId,
    changeSetId: changeSet.changeSetId,
    autoApprove: options.autoApprove ?? true,
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    verificationEnabled: options.verificationEnabled ?? true,
    iteration: 0,
    reviewNotes: '',
    verificationOutput: '',
    lastFingerprint: '',
  };

  pendingRuns.set(threadId, { threadId, spec, changeSetId: changeSet.changeSetId });

  log.info('Starting agent loop run', {
    source: 'agentLoopService#startRun',
    threadId,
    slug: spec.slug,
    autoApprove: initialState.autoApprove,
  });

  return yield* drive(threadId, initialState, spec, changeSet.changeSetId);
}

/**
 * Resumes a run that paused at the approval gate.
 */
export async function* resumeRun(
  threadId: string,
  approved: boolean,
): AsyncGenerator<LoopProgressEvent, LoopRunResult> {
  const run = pendingRuns.get(threadId);
  if (!run) {
    throw new Error(`No pending run for thread ${threadId}`);
  }
  log.info('Resuming agent loop run', { source: 'agentLoopService#resumeRun', threadId, approved });
  return yield* drive(threadId, new Command({ resume: approved }), run.spec, run.changeSetId);
}

export function hasPendingRun(threadId: string): boolean {
  return pendingRuns.has(threadId);
}

// ── Internal driver ──────────────────────────────────────────────────────────

async function* drive(
  threadId: string,
  input: Partial<LoopStateType> | Command,
  spec: TaskSpec,
  changeSetId: string,
): AsyncGenerator<LoopProgressEvent, LoopRunResult> {
  const graphConfig = { configurable: { thread_id: threadId }, recursionLimit: 100 };

  try {
    // Command's node-name generic can't be inferred here; the graph validates at runtime.
    const streamInput = input as Parameters<typeof graph.stream>[0];
    const stream = await graph.stream(streamInput, { ...graphConfig, streamMode: 'updates' });

    for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
      // Interrupt surfaces as an __interrupt__ chunk
      if ('__interrupt__' in chunk) {
        const state = await graph.getState(graphConfig);
        yield {
          type: 'awaiting_approval',
          message: 'Plan ready — awaiting approval',
          data: { threadId, plan: state.values.plan, task: spec.title },
        };
        return awaitingApprovalResult(spec, changeSetId);
      }

      for (const [node, update] of Object.entries(chunk)) {
        yield toEvent(node, update as Partial<LoopStateType>);
      }
    }

    // Stream complete — assemble the result from final state
    const finalState = (await graph.getState(graphConfig)).values as LoopStateType;
    pendingRuns.delete(threadId);
    await changeSetService.finalizeChangeSet(changeSetId);

    const result = buildResult(finalState, changeSetId);
    await persistCriteria(spec, result);

    yield { type: 'done', message: result.summary, data: { stopReason: result.stopReason } };
    return result;
  } catch (error: unknown) {
    pendingRuns.delete(threadId);
    const message = error instanceof Error ? error.message : String(error);
    log.error('Agent loop run failed', { source: 'agentLoopService#drive', threadId, error: message });
    yield { type: 'error', message: `Loop failed: ${message}` };
    return {
      stopReason: LoopStopReason.ERROR,
      iterations: 0,
      changeSetId,
      metCriteria: [],
      unmetCriteria: spec.criteria.map((c) => c.text),
      summary: `Loop failed: ${message}`,
    };
  }
}

function toEvent(node: string, update: Partial<LoopStateType>): LoopProgressEvent {
  const latest = update.history?.[update.history.length - 1];
  if (node === 'judge' && update.verdict) {
    return {
      type: 'verdict',
      node,
      message: update.verdict.complete ? 'Task complete' : `${update.verdict.unmetCriteria.length} criteria unmet`,
      data: { verdict: update.verdict as unknown as Record<string, unknown> },
    };
  }
  if (node === 'planning' && update.plan) {
    return { type: 'plan', node, message: 'Plan created', data: { plan: update.plan } };
  }
  if (node === 'implement') {
    return { type: 'iteration', node, iteration: update.iteration, message: latest ?? 'Implementing' };
  }
  return { type: 'node', node, message: latest ?? node };
}

function buildResult(state: LoopStateType, changeSetId: string): LoopRunResult {
  const unmet = state.verdict?.unmetCriteria ?? state.taskSpec.criteria.filter((c) => !c.done).map((c) => c.text);
  const met = state.taskSpec.criteria.map((c) => c.text).filter((t) => !unmet.includes(t));
  return {
    stopReason: state.stopReason ?? LoopStopReason.MAX_ITERATIONS,
    iterations: state.iteration,
    changeSetId,
    finalVerdict: state.verdict,
    metCriteria: met,
    unmetCriteria: unmet,
    summary: state.summary || 'Loop finished.',
  };
}

function awaitingApprovalResult(spec: TaskSpec, changeSetId: string): LoopRunResult {
  return {
    stopReason: LoopStopReason.REJECTED,
    iterations: 0,
    changeSetId,
    metCriteria: [],
    unmetCriteria: spec.criteria.map((c) => c.text),
    summary: 'Awaiting plan approval.',
  };
}

async function persistCriteria(spec: TaskSpec, result: LoopRunResult): Promise<void> {
  if (spec.sourcePath && result.metCriteria.length > 0) {
    await updateCriteriaStatus(spec, result.metCriteria).catch((err: unknown) => {
      log.warn('Failed to persist criteria status', {
        source: 'agentLoopService#persistCriteria',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
