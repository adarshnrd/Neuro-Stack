import type { AnalysisState } from '../state/analysis.state'

/**
 * Node 4 — Compute the efficiency score.
 *
 * Two scoring paths:
 *
 * A) If work item has estimated hours → accuracy-based score:
 *    score = 100 - |qwenEstimate - workItemEstimate| / workItemEstimate * 100
 *    High score = Qwen estimate closely matched actual estimate
 *
 * B) No estimation baseline → signal-based score:
 *    score = 50 + quality signals (tests/docs/refactor/bugfix)
 *
 * Result is rounded and clamped to [0, 100].
 */
export async function calculateScoreNode(state: AnalysisState): Promise<Partial<AnalysisState>> {
  const q = state.qwenEstimate
  if (!q) return { efficiencyScore: 0 }

  // Prefer the AI's code-aware efficiency score (quality of the delivered code).
  // Fall back to the accuracy/signal heuristics only when the model didn't return one.
  if (q.efficiencyScore != null) {
    return { efficiencyScore: Math.round(Math.max(0, Math.min(100, q.efficiencyScore))) }
  }

  let score: number

  if (
    state.hasWorkItem &&
    state.workItem?.estimatedHours != null &&
    state.workItem.estimatedHours > 0 &&
    q.estimatedEffortHours > 0
  ) {
    // Accuracy-based: how close did Qwen get to the pre-agreed estimate?
    const delta =
      (Math.abs(q.estimatedEffortHours - state.workItem.estimatedHours) /
        state.workItem.estimatedHours) *
      100
    score = 100 - delta
  } else {
    // Signal-based: reward quality indicators
    score =
      50 +
      (q.hasTests ? 15 : 0) +
      (q.hasDocumentation ? 10 : 0) +
      (q.hasRefactoring ? 5 : 0) +
      (q.hasBugFix ? 5 : 0)
  }

  return { efficiencyScore: Math.round(Math.max(0, Math.min(100, score))) }
}
