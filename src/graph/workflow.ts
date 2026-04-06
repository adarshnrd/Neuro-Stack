import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { AgentState, StateType } from './state.js';
import { logger } from '../logger/index.js';

// Dummy nodes for phase 1 initial test
const contextInjectorNode = async (state: StateType) => {
  logger.info('Running context injector node');
  return { executionLog: ['Context injected'] };
};

const commandRouterNode = async (state: StateType) => {
  logger.info('Running command router node');
  return { executionLog: ['Command routed'] };
};

const plannerNode = async (state: StateType) => {
  logger.info('Running planner node');
  return { executionLog: ['Plan created'] };
};

export function buildGraph() {
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
