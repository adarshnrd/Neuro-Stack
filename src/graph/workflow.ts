import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { AgentState, StateType } from './state.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('workflow');

// Dummy nodes for phase 1 initial test
const contextInjectorNode = async (state: StateType) => {
  log.debug('Executing contextInjector node', { source: 'workflow#contextInjectorNode', sessionId: state.sessionId });
  return { executionLog: ['Context injected'] };
};

const commandRouterNode = async (state: StateType) => {
  log.debug('Executing commandRouter node', { source: 'workflow#commandRouterNode', sessionId: state.sessionId });
  return { executionLog: ['Command routed'] };
};

const plannerNode = async (state: StateType) => {
  log.debug('Executing planner node', { source: 'workflow#plannerNode', sessionId: state.sessionId });
  return { executionLog: ['Plan created'] };
};

export function buildGraph() {
  log.info('Compiling graph workflow', { source: 'workflow#buildGraph' });
  const checkpointer = new MemorySaver();
  
  const workflow = new StateGraph(AgentState)
    .addNode('contextInjector', contextInjectorNode)
    .addNode('commandRouter', commandRouterNode)
    .addNode('planner', plannerNode)
    .addEdge(START, 'contextInjector')
    .addEdge('contextInjector', 'commandRouter')
    .addEdge('commandRouter', 'planner')
    .addEdge('planner', END);

  return workflow.compile({ checkpointer });
}
