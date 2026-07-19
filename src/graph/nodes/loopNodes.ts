import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { LoopStateType } from '../loopState.js';
import { implementSystemPrompt, planPrompt, reviewPrompt, verdictPrompt } from '../prompts.js';
import { ModelRole } from '../../enums/index.js';
import { LoopStopReason, LoopVerdict } from '../../types/agentTaskTypes.js';
import { invokeForRole } from '../../llm/llmService.js';
import { runAgentLoop } from '../../llm/agentLoop.js';
import { changeSetContext } from '../../services/changeSetContext.js';
import { changeSetService } from '../../services/changeSetService.js';
import { runChecks } from '../../services/verificationService.js';
import { ALL_FILE_TOOLS } from '../../tools/fileTools.js';
import { runCheckTool } from '../../tools/verifyTools.js';
import { AGENT_TOOL_GUIDANCE } from '../../constants/commandConstants.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('loopNodes');

/** PLANNER: analyze the task and produce an implementation plan. */
export async function planNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  log.info('Node: plan', { source: 'loopNodes#planNode', sessionId: state.sessionId });
  const plan = await invokeForRole(ModelRole.PLANNER, [new HumanMessage(planPrompt(state.taskSpec))]);
  return { plan, history: [`Planned: ${firstLine(plan)}`] };
}

/**
 * Approval gate. In autoApprove mode it passes straight through; otherwise it
 * interrupts the graph, surfacing the plan for a human decision. Resume with a
 * boolean or `{ approved: boolean }`.
 */
export async function approvalNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  if (state.autoApprove) {
    return { planApproved: true, history: ['Plan auto-approved'] };
  }

  const decision = interrupt({ type: 'plan_approval', plan: state.plan, task: state.taskSpec.title }) as
    | boolean
    | { approved?: boolean };
  const approved = typeof decision === 'boolean' ? decision : decision?.approved === true;

  return approved
    ? { planApproved: true, history: ['Plan approved by user'] }
    : { planApproved: false, stopReason: LoopStopReason.REJECTED, history: ['Plan rejected by user'] };
}

/** CODER: run the tool loop to implement (or rework) against the plan and findings. */
export async function implementNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  const iteration = state.iteration + 1;
  log.info('Node: implement', { source: 'loopNodes#implementNode', iteration, sessionId: state.sessionId });

  const tools = state.verificationEnabled ? [...ALL_FILE_TOOLS, runCheckTool] : ALL_FILE_TOOLS;
  const system = implementSystemPrompt(
    state.taskSpec,
    state.plan,
    state.reviewNotes ?? '',
    state.verificationOutput ?? '',
    AGENT_TOOL_GUIDANCE,
  );
  const messages = [new SystemMessage(system), new HumanMessage(iterationInstruction(iteration))];

  const result = await changeSetContext.run(state.changeSetId, () => runAgentLoop(messages, tools));

  return {
    iteration,
    history: [`Iteration ${iteration}: ${result.toolCallCount} tool calls${result.hitRoundCap ? ' (hit round cap)' : ''}`],
  };
}

/** Runs configured verification checks against staged changes (Phase 3). */
export async function verifyNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  if (!state.verificationEnabled) return {};

  log.info('Node: verify', { source: 'loopNodes#verifyNode', sessionId: state.sessionId });
  const result = await runChecks(state.changeSetId, ['typecheck', 'test']);
  return {
    verificationOutput: result.output,
    history: [`Verification: ${result.ran.join(', ') || 'none'} — ${result.allPassed ? 'passed' : 'failed'}`],
  };
}

/** REVIEWER (fresh context): gap analysis of staged changes vs. the criteria. */
const REVIEW_NOTES_MAX_CHARS = 4_000;

export async function reviewNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  log.info('Node: review', { source: 'loopNodes#reviewNode', sessionId: state.sessionId });
  const staged = changeSetService.renderForReview(state.changeSetId);
  const raw = await invokeForRole(ModelRole.REVIEWER, [
    new HumanMessage(reviewPrompt(state.taskSpec, staged, state.verificationOutput ?? '')),
  ]);
  // Cap before it feeds the validator — reasoning models can be very verbose,
  // and downstream providers have per-request token limits.
  const reviewNotes = raw.length > REVIEW_NOTES_MAX_CHARS
    ? `${raw.slice(0, REVIEW_NOTES_MAX_CHARS)}\n…[truncated]`
    : raw;
  return { reviewNotes, history: [`Reviewed: ${firstLine(reviewNotes)}`] };
}

/** VALIDATOR: structured verdict + stall detection. */
export async function verdictNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  log.info('Node: verdict', { source: 'loopNodes#verdictNode', sessionId: state.sessionId });
  const raw = await invokeForRole(ModelRole.VALIDATOR, [
    new HumanMessage(verdictPrompt(state.taskSpec, state.reviewNotes ?? '', state.verificationOutput ?? '')),
  ]);
  const verdict = parseVerdict(raw);

  const fingerprint = changeSetService.fingerprint(state.changeSetId);
  const stalled = fingerprint !== '' && fingerprint === state.lastFingerprint && !verdict.complete;
  const noChanges = fingerprint === '';

  let stopReason: LoopStopReason | undefined;
  if (verdict.complete) stopReason = LoopStopReason.COMPLETE;
  else if (noChanges) stopReason = LoopStopReason.NO_CHANGES;
  else if (stalled) stopReason = LoopStopReason.STALLED;
  else if (state.iteration >= state.maxIterations) stopReason = LoopStopReason.MAX_ITERATIONS;

  return {
    verdict,
    lastFingerprint: fingerprint,
    stopReason,
    history: [`Verdict: ${verdict.complete ? 'COMPLETE' : `${verdict.unmetCriteria.length} unmet`}`],
  };
}

/** Assembles the final summary and stop reason. */
export async function finalizeNode(state: LoopStateType): Promise<Partial<LoopStateType>> {
  const stopReason = state.stopReason ?? LoopStopReason.MAX_ITERATIONS;
  log.info('Node: finalize', { source: 'loopNodes#finalizeNode', stopReason, sessionId: state.sessionId });

  const met = state.taskSpec.criteria
    .map((c) => c.text)
    .filter((t) => !(state.verdict?.unmetCriteria ?? []).includes(t));
  const summary = [
    `Loop finished after ${state.iteration} iteration(s) — ${stopReason}.`,
    `Criteria met: ${met.length}/${state.taskSpec.criteria.length}.`,
    state.verdict && !state.verdict.complete && state.verdict.findings.length
      ? `Outstanding: ${state.verdict.findings.join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { stopReason, summary, history: [`Finalized: ${stopReason}`] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function iterationInstruction(iteration: number): string {
  return iteration === 1
    ? 'Implement the task now using the tools. Verify your work, then summarize what you changed.'
    : 'Address the reviewer findings above. Make the necessary changes with the tools, verify, then summarize.';
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim()) ?? '').slice(0, 100);
}

/** Extracts the verdict JSON from a model reply, tolerating surrounding prose. */
export function parseVerdict(raw: string): LoopVerdict {
  const fallback: LoopVerdict = {
    complete: false,
    unmetCriteria: [],
    findings: ['Could not parse validator response'],
    reworkGuidance: 'Re-attempt the implementation.',
  };

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;

  try {
    const parsed = JSON.parse(match[0]) as Partial<LoopVerdict>;
    return {
      complete: parsed.complete === true,
      unmetCriteria: Array.isArray(parsed.unmetCriteria) ? parsed.unmetCriteria.map(String) : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings.map(String) : [],
      reworkGuidance: typeof parsed.reworkGuidance === 'string' ? parsed.reworkGuidance : '',
    };
  } catch {
    return fallback;
  }
}
