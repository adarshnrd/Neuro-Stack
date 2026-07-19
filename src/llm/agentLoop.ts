import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Logger } from 'winston';
import { LLMProvider, ModelRole } from '../enums/index.js';
import { resolveRoleChain } from './modelRouter.js';
import { contentToString, invokeForRole, invokeModelWithRetry, classifyProviderError, ProviderErrorKind } from './llmService.js';
import { createChildLogger, withQueryId } from '../logger/index.js';

const log = createChildLogger('agentLoop');

const MAX_TOOL_ROUNDS = 15;
const TOOL_RESULT_MAX_CHARS = 8_000;
const TRANSCRIPT_CHAR_BUDGET = 90_000;
const KEEP_RECENT_ROUNDS = 2;
// On a provider handoff, compress harder — the next provider may have a much
// smaller context/token budget (e.g. Groq's free-tier TPM).
const KEEP_RECENT_ROUNDS_ON_HANDOFF = 1;

// Proactive per-provider transcript budgets (chars ≈ 4×tokens). Kept well under
// each provider's real limit so we compress BEFORE a hard context/rate error —
// this matters most right after a handoff to a smaller-budget provider.
const DEFAULT_PROVIDER_BUDGET = 90_000;
const PROVIDER_CHAR_BUDGET: Partial<Record<LLMProvider, number>> = {
  [LLMProvider.GEMINI]: 400_000,
  [LLMProvider.GROQ]: 28_000, // free-tier ~12k TPM
  [LLMProvider.NVIDIA]: 60_000,
  [LLMProvider.NVIDIA_ULTRA]: 120_000,
};

export interface HandoffInfo {
  fromProvider: string;
  toProvider: string;
  reason: string;
  round: number;
}

export interface AgentLoopOptions {
  queryId?: string;
  maxToolRounds?: number;
  /** Called after each round with the tools that ran — lets callers persist progress. */
  onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
  /** Called when the coder loop fails over from one provider to another mid-task. */
  onHandoff?: (info: HandoffInfo) => void | Promise<void>;
}

export interface AgentLoopEvent {
  round: number;
  toolCalls: { name: string; args: unknown }[];
  compressed: boolean;
}

export interface AgentLoopResult {
  content: string;
  rounds: number;
  toolCallCount: number;
  compressed: boolean;
  hitRoundCap: boolean;
  /** How many times the loop handed off to a different provider mid-task. */
  handoffCount: number;
}

/**
 * ReAct-style execute-observe loop: the CODER model is invoked with bound
 * tools; returned tool calls are executed and their results appended as
 * observations, repeating until the model answers without tool calls or the
 * round cap is hit. Older rounds are compressed via the SUMMARIZER role when
 * the transcript outgrows its budget.
 *
 * The loop is transport-only: staging/review semantics live in the tools
 * themselves (write_file stages into the active changeset).
 */
export async function runAgentLoop(
  initialMessages: BaseMessage[],
  tools: StructuredToolInterface[],
  options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const traceLog = options.queryId ? withQueryId(log, options.queryId) : log;
  const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;

  // Full coder provider chain — the loop fails over across these on exhaustion.
  const chain = resolveRoleChain(ModelRole.CODER).filter((entry) => entry.model.bindTools);
  if (chain.length === 0) {
    throw new Error('No CODER provider supports tool binding');
  }
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const head: BaseMessage[] = [...initialMessages];
  // Each segment is one complete round: [AIMessage(tool_calls), ...ToolMessages].
  // Compression only ever removes whole segments, so tool-call/result pairing
  // stays valid across a provider switch.
  const roundSegments: BaseMessage[][] = [];
  let summaryMessage: HumanMessage | null = null;
  let toolCallCount = 0;
  let compressed = false;

  // Active provider state (advances on handoff).
  let providerIdx = 0;
  let boundModel = bindTools(chain[0].model, tools);
  let handoffCount = 0;

  const transcript = (): BaseMessage[] => [
    ...head,
    ...(summaryMessage ? [summaryMessage] : []),
    ...roundSegments.flat(),
  ];

  const compressOld = async (keepRecent: number): Promise<void> => {
    if (roundSegments.length > keepRecent) {
      const older = roundSegments.splice(0, roundSegments.length - keepRecent);
      summaryMessage = await compressSegments(summaryMessage, older, options.queryId);
      compressed = true;
    }
  };

  /**
   * Invokes the current provider; on an EXHAUSTED error, hands off to the next
   * provider in the chain (compressing the transcript first so a smaller-budget
   * model can accept it) and retries. Throws only when every provider is spent.
   */
  const invokeCoder = async (round: number, wrapUp: boolean): Promise<AIMessage> => {
    for (;;) {
      // Proactive fit: compress to the current provider's budget before calling,
      // so we don't waste a round discovering the transcript is too large.
      const budget = PROVIDER_CHAR_BUDGET[chain[providerIdx].provider] ?? DEFAULT_PROVIDER_BUDGET;
      if (charCount(transcript()) > budget) {
        await compressOld(KEEP_RECENT_ROUNDS_ON_HANDOFF);
      }

      try {
        const model = wrapUp ? chain[providerIdx].model : boundModel;
        return (await invokeModelWithRetry(
          model,
          transcript().concat(wrapUp ? [WRAP_UP_MESSAGE] : []),
          options.queryId,
          `coder@${chain[providerIdx].provider}${wrapUp ? ':wrapup' : ''}`,
        )) as AIMessage;
      } catch (error: unknown) {
        const exhausted = classifyProviderError(error) === ProviderErrorKind.EXHAUSTED;
        if (!exhausted || providerIdx >= chain.length - 1) throw error;

        const fromProvider = chain[providerIdx].provider;
        providerIdx++;
        boundModel = bindTools(chain[providerIdx].model, tools);
        handoffCount++;
        await compressOld(KEEP_RECENT_ROUNDS_ON_HANDOFF);

        const info: HandoffInfo = {
          fromProvider,
          toProvider: chain[providerIdx].provider,
          reason: error instanceof Error ? error.message : String(error),
          round,
        };
        traceLog.warn('Coder provider exhausted — handing off', { source: 'agentLoop#invokeCoder', ...info });
        await options.onHandoff?.(info);
      }
    }
  };

  for (let round = 1; round <= maxRounds; round++) {
    const response = await invokeCoder(round, false);

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      traceLog.info('Agent loop complete', {
        source: 'agentLoop#runAgentLoop',
        rounds: round,
        toolCallCount,
        handoffCount,
      });
      return { content: contentToString(response.content), rounds: round, toolCallCount, compressed, hitRoundCap: false, handoffCount };
    }

    // Store a normalized assistant message (string content + tool_calls) so the
    // transcript stays portable — a provider switch mid-loop must not choke on
    // another provider's content format (e.g. Groq rejects Gemini's block form).
    const segment: BaseMessage[] = [normalizeAssistant(response)];
    for (const call of toolCalls) {
      toolCallCount++;
      const result = await executeTool(toolsByName, call.name, call.args, traceLog);
      segment.push(new ToolMessage({ content: result, tool_call_id: call.id ?? `call_${toolCallCount}` }));
    }
    roundSegments.push(segment);

    if (charCount(transcript()) > TRANSCRIPT_CHAR_BUDGET) {
      await compressOld(KEEP_RECENT_ROUNDS);
      traceLog.info('Transcript compressed', { source: 'agentLoop#runAgentLoop', round });
    }

    if (options.onEvent) {
      await options.onEvent({
        round,
        compressed,
        toolCalls: toolCalls.map((c) => ({ name: c.name, args: c.args })),
      });
    }
  }

  // Round cap hit — one final call (with handoff support) for a coherent answer
  traceLog.warn('Agent loop hit round cap', { source: 'agentLoop#runAgentLoop', maxRounds, toolCallCount });
  const wrapUp = await invokeCoder(maxRounds, true);
  return { content: contentToString(wrapUp.content), rounds: maxRounds, toolCallCount, compressed, hitRoundCap: true, handoffCount };
}

const WRAP_UP_MESSAGE = new HumanMessage(
  'You have reached the tool-call budget. Summarize what you accomplished, what remains to be done, and any changes made.',
);

/** Binds tools to a model, asserting the capability the chain filter already guaranteed. */
function bindTools(model: BaseChatModel, tools: StructuredToolInterface[]) {
  if (!model.bindTools) throw new Error('Model does not support tool binding');
  return model.bindTools(tools);
}

/**
 * Rebuilds an assistant message with plain string content while preserving its
 * tool calls, so the stored transcript is accepted by any provider regardless
 * of the block/content shape the originating provider emitted.
 */
function normalizeAssistant(msg: AIMessage): AIMessage {
  return new AIMessage({
    content: typeof msg.content === 'string' ? msg.content : contentToString(msg.content),
    tool_calls: msg.tool_calls ?? [],
  });
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function executeTool(
  toolsByName: Map<string, StructuredToolInterface>,
  name: string,
  args: unknown,
  traceLog: Logger,
): Promise<string> {
  const selectedTool = toolsByName.get(name);
  if (!selectedTool) return `Error: unknown tool "${name}"`;

  try {
    const result = await selectedTool.invoke(args ?? {});
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return text.length > TOOL_RESULT_MAX_CHARS
      ? `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[truncated ${text.length - TOOL_RESULT_MAX_CHARS} chars]`
      : text;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    traceLog.warn('Tool execution failed — feeding error back to model', {
      source: 'agentLoop#executeTool',
      tool: name,
      error: message,
    });
    return `Error executing ${name}: ${message}`;
  }
}

function charCount(messages: BaseMessage[]): number {
  return messages.reduce((total, m) => total + contentToString(m.content).length, 0);
}

function renderSegments(segments: BaseMessage[][]): string {
  return segments
    .flat()
    .map((m) => {
      if (m instanceof ToolMessage) return `[tool result] ${contentToString(m.content)}`;
      const ai = m as AIMessage;
      const calls = (ai.tool_calls ?? [])
        .map((c) => `${c.name}(${JSON.stringify(c.args)})`)
        .join(', ');
      return `[assistant] ${contentToString(ai.content)}${calls ? ` → calls: ${calls}` : ''}`;
    })
    .join('\n');
}

async function compressSegments(
  previousSummary: HumanMessage | null,
  segments: BaseMessage[][],
  queryId?: string,
): Promise<HumanMessage> {
  const rendered = renderSegments(segments).slice(0, 40_000);
  const prior = previousSummary ? `Previous summary:\n${contentToString(previousSummary.content)}\n\n` : '';

  const summary = await invokeForRole(
    ModelRole.SUMMARIZER,
    [
      new SystemMessage(
        'You compress agent work transcripts. Preserve: files read/written/deleted, key findings, decisions made, and outstanding work. Be terse but complete.',
      ),
      new HumanMessage(`${prior}Transcript to compress:\n${rendered}`),
    ],
    queryId,
  );

  return new HumanMessage(`[Progress summary of earlier tool activity — compressed]\n${summary}`);
}
