import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  sessionId: Annotation<string>,

  command: Annotation<string>,
  commandArgs: Annotation<Record<string, unknown>>,

  plan: Annotation<string>,
  planApproved: Annotation<boolean>,
  clarificationNeeded: Annotation<boolean>,
  clarificationQuestion: Annotation<string>,

  generatedCode: Annotation<Map<string, string>>,
  generatedFiles: Annotation<string[]>,

  reviewFeedback: Annotation<string>,
  reviewApproved: Annotation<boolean>,

  gitBranch: Annotation<string>,
  prNumber: Annotation<number>,
  prUrl: Annotation<string>,

  systemContext: Annotation<string>,
  commandContext: Annotation<string>,
  sessionContext: Annotation<string>,
  learnedContext: Annotation<string>,
  agentGuidelines: Annotation<string>,

  executionLog: Annotation<string[]>({ reducer: (a, b) => [...a, ...b] }),
});

export type StateType = typeof AgentState.State;
