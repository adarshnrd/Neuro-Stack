/** Lifecycle status of a folder-agent run, persisted in state.json. */
export enum RunStatus {
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/** The durable run state (`.neurostack/state.json`). */
export interface RunState {
  runId: string;
  status: RunStatus;
  iterations: number;
  currentModel?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single append-only progress event (`.neurostack/progress-log.jsonl`). */
export interface ProgressEvent {
  ts: string;
  type: string;
  message: string;
  model?: string;
  data?: Record<string, unknown>;
}

/** The task plan with criteria statuses (`.neurostack/plan.json`). */
export interface StoredPlan {
  requirement: string;
  criteria: { text: string; done: boolean }[];
}

/**
 * The compact, model-portable "onboarding packet" reconstructed from the state
 * store on resume — spec + pending work + rolling summary + open issues. This
 * is what a fresh model (same or different) re-ingests to continue seamlessly.
 */
export interface OnboardingPacket {
  requirement: string;
  pendingCriteria: string[];
  doneCriteria: string[];
  summary: string;
  openIssues: string;
  decisions: string;
  priorIterations: number;
}
