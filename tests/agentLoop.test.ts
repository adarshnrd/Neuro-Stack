import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * Mock model router with per-provider response queues. Each queued item is
 * either an AIMessage (returned) or an Error (thrown) — letting tests script
 * provider exhaustion and verify cross-model handoff.
 */
const { fakeState } = vi.hoisted(() => ({
  fakeState: {
    invocations: [] as { provider: string; messages: BaseMessage[] }[],
    queues: {} as Record<string, (AIMessage | Error)[]>,
    providers: ['primary'] as string[],
  },
}));

vi.mock('../src/llm/modelRouter.js', () => {
  const makeModel = (provider: string) => {
    const invoke = async (messages: BaseMessage[]) => {
      fakeState.invocations.push({ provider, messages });
      const item = fakeState.queues[provider]?.shift();
      if (item instanceof Error) throw item;
      return item ?? new AIMessage('default-done');
    };
    return { invoke, bindTools: () => ({ invoke }) };
  };
  return {
    resolveRoleChain: () => fakeState.providers.map((p) => ({ provider: p, model: makeModel(p) })),
  };
});

import { runAgentLoop } from '../src/llm/agentLoop.js';

const echoTool = tool(async ({ text }: { text: string }) => `echo:${text}`, {
  name: 'echo',
  description: 'Echoes text back',
  schema: z.object({ text: z.string() }),
});

const failingTool = tool(
  async () => {
    throw new Error('disk on fire');
  },
  { name: 'broken', description: 'Always fails', schema: z.object({}) },
);

const toolCall = (name: string, args: object, id: string) =>
  new AIMessage({ content: '', tool_calls: [{ name, args, id }] });

describe('runAgentLoop', () => {
  beforeEach(() => {
    fakeState.invocations = [];
    fakeState.queues = {};
    fakeState.providers = ['primary'];
  });

  it('returns immediately when the model makes no tool calls', async () => {
    fakeState.queues.primary = [new AIMessage('plain answer')];
    const result = await runAgentLoop([new HumanMessage('hi')], [echoTool]);
    expect(result.content).toBe('plain answer');
    expect(result.rounds).toBe(1);
    expect(result.toolCallCount).toBe(0);
    expect(result.handoffCount).toBe(0);
  });

  it('executes tool calls and feeds results back to the model', async () => {
    fakeState.queues.primary = [toolCall('echo', { text: 'hi' }, 'c1'), new AIMessage('final answer')];
    const result = await runAgentLoop([new HumanMessage('use the tool')], [echoTool]);

    expect(result.content).toBe('final answer');
    expect(result.rounds).toBe(2);
    expect(result.toolCallCount).toBe(1);

    const secondCall = fakeState.invocations[1].messages;
    const toolMessage = secondCall.find((m) => m.getType() === 'tool');
    expect(String(toolMessage!.content)).toBe('echo:hi');
  });

  it('feeds tool errors back as observations instead of throwing', async () => {
    fakeState.queues.primary = [toolCall('broken', {}, 'c1'), new AIMessage('recovered')];
    const result = await runAgentLoop([new HumanMessage('try it')], [failingTool]);
    expect(result.content).toBe('recovered');
    const toolMessage = fakeState.invocations[1].messages.find((m) => m.getType() === 'tool');
    expect(String(toolMessage!.content)).toContain('disk on fire');
  });

  it('stops at the round cap and produces a wrap-up answer', async () => {
    fakeState.queues.primary = [
      toolCall('echo', { text: 'a' }, 'c1'),
      toolCall('echo', { text: 'b' }, 'c2'),
      new AIMessage('wrap-up summary'),
    ];
    const result = await runAgentLoop([new HumanMessage('loop')], [echoTool], { maxToolRounds: 2 });
    expect(result.content).toBe('wrap-up summary');
    expect(result.hitRoundCap).toBe(true);
    expect(result.rounds).toBe(2);
  });

  // ── Cross-model handoff (Phase F) ──

  it('hands off to the next provider when the primary is exhausted', async () => {
    fakeState.providers = ['primary', 'secondary'];
    fakeState.queues.primary = [new Error('429 quota exceeded')];
    fakeState.queues.secondary = [new AIMessage('done by secondary')];

    const handoffs: { from: string; to: string }[] = [];
    const result = await runAgentLoop([new HumanMessage('go')], [echoTool], {
      onHandoff: (info) => {
        handoffs.push({ from: info.fromProvider, to: info.toProvider });
      },
    });

    expect(result.content).toBe('done by secondary');
    expect(result.handoffCount).toBe(1);
    expect(handoffs).toEqual([{ from: 'primary', to: 'secondary' }]);
  });

  it('preserves progress across a mid-task handoff', async () => {
    fakeState.providers = ['primary', 'secondary'];
    // primary does one tool round, then exhausts; secondary finishes
    fakeState.queues.primary = [toolCall('echo', { text: 'x' }, 'c1'), new Error('rate limit reached')];
    fakeState.queues.secondary = [new AIMessage('finished after handoff')];

    const result = await runAgentLoop([new HumanMessage('go')], [echoTool]);
    expect(result.content).toBe('finished after handoff');
    expect(result.handoffCount).toBe(1);
    expect(result.toolCallCount).toBe(1); // the primary's tool work was not lost
  });

  it('throws an exhaustion error when every provider is spent', async () => {
    fakeState.providers = ['primary', 'secondary'];
    fakeState.queues.primary = [new Error('quota exceeded')];
    fakeState.queues.secondary = [new Error('429 too many requests')];

    await expect(runAgentLoop([new HumanMessage('go')], [echoTool])).rejects.toThrow(/429|quota/i);
  });

  it('does not hand off on a fatal (non-exhaustion) error', async () => {
    fakeState.providers = ['primary', 'secondary'];
    fakeState.queues.primary = [new Error('Invalid API key')];
    fakeState.queues.secondary = [new AIMessage('should not reach here')];

    await expect(runAgentLoop([new HumanMessage('go')], [echoTool])).rejects.toThrow(/Invalid API key/);
  });
});
