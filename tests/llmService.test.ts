import { describe, it, expect, vi, afterEach } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import {
  contentToString,
  invokeModelWithRetry,
  classifyProviderError,
  isExhaustionError,
  ProviderErrorKind,
} from '../src/llm/llmService.js';

describe('classifyProviderError', () => {
  it('classifies quota / rate-limit / context errors as EXHAUSTED', () => {
    for (const msg of [
      'You exceeded your current quota',
      '429 Too Many Requests',
      'Rate limit reached for model',
      'Request too large for model ... tokens per minute (TPM)',
      'This model\'s maximum context length is 8192 tokens',
      'resource_exhausted',
    ]) {
      expect(classifyProviderError(new Error(msg)), msg).toBe(ProviderErrorKind.EXHAUSTED);
      expect(isExhaustionError(new Error(msg)), msg).toBe(true);
    }
  });

  it('classifies network blips and 5xx as RETRYABLE', () => {
    for (const msg of ['model is overloaded', 'high demand', '503 Service Unavailable', 'ECONNRESET', 'fetch failed']) {
      expect(classifyProviderError(new Error(msg)), msg).toBe(ProviderErrorKind.RETRYABLE);
    }
  });

  it('classifies everything else as FATAL', () => {
    expect(classifyProviderError(new Error('Invalid API key'))).toBe(ProviderErrorKind.FATAL);
    expect(classifyProviderError(new Error('bad request: unknown field'))).toBe(ProviderErrorKind.FATAL);
  });
});

describe('contentToString', () => {
  it('returns plain strings unchanged', () => {
    expect(contentToString('hello')).toBe('hello');
  });

  it('strips <think> reasoning blocks', () => {
    expect(contentToString('<think>step 1\nstep 2</think>\nThe answer is 42.')).toBe('The answer is 42.');
  });

  it('strips multiple think blocks', () => {
    expect(contentToString('<think>a</think>x<think>b</think>y')).toBe('xy');
  });

  it('stringifies structured content', () => {
    expect(contentToString([{ type: 'text', text: 'hi' }])).toBe('[{"type":"text","text":"hi"}]');
  });
});

describe('invokeModelWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient errors and eventually succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const model = {
      invoke: async () => {
        calls++;
        if (calls < 3) throw new Error('503 model is overloaded');
        return new AIMessage('done');
      },
    };

    const pending = invokeModelWithRetry(model, []);
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;

    expect(contentToString(response.content)).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws immediately on non-transient errors', async () => {
    let calls = 0;
    const model = {
      invoke: async () => {
        calls++;
        throw new Error('Invalid API key');
      },
    };

    await expect(invokeModelWithRetry(model, [])).rejects.toThrow('Invalid API key');
    expect(calls).toBe(1);
  });

  it('gives up after exhausting retries on persistent transient errors', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const model = {
      invoke: async () => {
        calls++;
        throw new Error('model overloaded');
      },
    };

    const pending = invokeModelWithRetry(model, []).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('model overloaded');
    expect(calls).toBe(3);
  });
});
