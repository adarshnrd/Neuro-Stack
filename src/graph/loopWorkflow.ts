import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { LoopState, LoopStateType } from './loopState.js';
import {
  planNode,
  approvalNode,
  implementNode,
  verifyNode,
  reviewNode,
  verdictNode,
  finalizeNode,
} from './nodes/loopNodes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('loopWorkflow');

/** Route after the approval gate: rejected plans skip straight to finalize. */
function afterApproval(state: LoopStateType): 'implement' | 'finalize' {
  return state.planApproved ? 'implement' : 'finalize';
}

/** Route after the verdict: complete/stalled/capped → finalize, else rework. */
function afterVerdict(state: LoopStateType): 'implement' | 'finalize' {
  return state.stopReason ? 'finalize' : 'implement';
}

/**
 * Compiles the autonomous agent loop:
 *
 *   plan → approval →(reject)→ finalize
 *                   →(approve)→ implement → verify → review → verdict
 *                                  ↑___________(rework)___________|
 *                                              →(done)→ finalize
 *
 * A MemorySaver checkpointer persists state across the approval interrupt so
 * the run can be resumed after a human decision.
 */
export function buildLoopGraph() {
  log.info('Compiling agent loop graph', { source: 'loopWorkflow#buildLoopGraph' });

  // Node names must not collide with state channel names (e.g. `plan`, `verdict`)
  const workflow = new StateGraph(LoopState)
    .addNode('planning', planNode)
    .addNode('approval', approvalNode)
    .addNode('implement', implementNode)
    .addNode('verify', verifyNode)
    .addNode('review', reviewNode)
    .addNode('judge', verdictNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'planning')
    .addEdge('planning', 'approval')
    .addConditionalEdges('approval', afterApproval, { implement: 'implement', finalize: 'finalize' })
    .addEdge('implement', 'verify')
    .addEdge('verify', 'review')
    .addEdge('review', 'judge')
    .addConditionalEdges('judge', afterVerdict, { implement: 'implement', finalize: 'finalize' })
    .addEdge('finalize', END);

  return workflow.compile({ checkpointer: new MemorySaver() });
}
