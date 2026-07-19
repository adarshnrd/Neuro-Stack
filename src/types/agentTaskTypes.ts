/**
 * A single acceptance criterion parsed from a task spec's checklist.
 */
export interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

/**
 * A task specification: the goal, its acceptance criteria, and optional
 * metadata. Parsed from `tasks/<slug>.md`.
 */
export interface TaskSpec {
  slug: string;
  title: string;
  description: string;
  criteria: AcceptanceCriterion[];
  /** Absolute path the spec was loaded from, if any. */
  sourcePath?: string;
}

/**
 * Structured verdict produced by the VALIDATOR role each iteration.
 */
export interface LoopVerdict {
  complete: boolean;
  unmetCriteria: string[];
  findings: string[];
  /** Free-text guidance for the next rework iteration. */
  reworkGuidance: string;
}

export enum LoopStopReason {
  COMPLETE = 'complete',
  MAX_ITERATIONS = 'max_iterations',
  STALLED = 'stalled',
  NO_CHANGES = 'no_changes',
  REJECTED = 'rejected',
  ERROR = 'error',
}

/**
 * Outcome of a full agent-loop run.
 */
export interface LoopRunResult {
  stopReason: LoopStopReason;
  iterations: number;
  changeSetId?: string;
  finalVerdict?: LoopVerdict;
  metCriteria: string[];
  unmetCriteria: string[];
  summary: string;
}

/**
 * A single progress event emitted while the loop runs (for SSE streaming).
 */
export interface LoopProgressEvent {
  type: 'node' | 'iteration' | 'plan' | 'verdict' | 'awaiting_approval' | 'done' | 'error';
  node?: string;
  iteration?: number;
  message: string;
  data?: Record<string, unknown>;
}
