import { Annotation } from '@langchain/langgraph';
import { LoopStopReason, LoopVerdict, TaskSpec } from '../types/agentTaskTypes.js';

/**
 * State for the autonomous agent loop:
 * plan → approval → implement → verify → review → verdict → (rework | finalize)
 */
export const LoopState = Annotation.Root({
  // ── Inputs (set once) ──
  taskSpec: Annotation<TaskSpec>,
  sessionId: Annotation<string>,
  changeSetId: Annotation<string>,
  autoApprove: Annotation<boolean>,
  maxIterations: Annotation<number>,
  verificationEnabled: Annotation<boolean>,

  // ── Evolving state ──
  plan: Annotation<string>,
  planApproved: Annotation<boolean>,
  iteration: Annotation<number>,
  reviewNotes: Annotation<string>,
  verificationOutput: Annotation<string>,
  verdict: Annotation<LoopVerdict | undefined>,
  lastFingerprint: Annotation<string>,
  stopReason: Annotation<LoopStopReason | undefined>,
  summary: Annotation<string>,

  // ── Append-only progress log ──
  history: Annotation<string[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
});

export type LoopStateType = typeof LoopState.State;
