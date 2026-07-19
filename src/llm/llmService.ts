import { BaseMessage } from '@langchain/core/messages';
import { Logger } from 'winston';
import { ModelRole } from '../enums/index.js';
import { resolveRoleChain } from './modelRouter.js';
import { createChildLogger, withQueryId } from '../logger/index.js';

const log = createChildLogger('llmService');

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/** Anything with a message-array invoke — a chat model or a tool-bound runnable. */
export interface InvocableModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
}

/**
 * How to react to a provider error:
 * - RETRYABLE: transient blip → back off and retry the SAME provider.
 * - EXHAUSTED: quota / rate-limit / context-overflow → stop retrying, fail over
 *   to the next provider in the chain (a different model).
 * - FATAL: auth / bad-request → neither retry nor fail over; surface it.
 */
export enum ProviderErrorKind {
  RETRYABLE = 'retryable',
  EXHAUSTED = 'exhausted',
  FATAL = 'fatal',
}

const EXHAUSTED_RE =
  /quota|exceeded your current quota|rate.?limit|too many requests|429|resource[_ ]?exhausted|tokens per (minute|day)|\bTPM\b|\bRPM\b|\bRPD\b|request too large|context length|maximum context|context window|too many tokens|\b413\b/i;
const RETRYABLE_RE = /high demand|overloaded|\b502\b|\b503\b|\b504\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|network/i;

export function classifyProviderError(error: unknown): ProviderErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (EXHAUSTED_RE.test(message)) return ProviderErrorKind.EXHAUSTED;
  if (RETRYABLE_RE.test(message)) return ProviderErrorKind.RETRYABLE;
  return ProviderErrorKind.FATAL;
}

/** True when the error means the current provider is out of capacity (should fail over). */
export function isExhaustionError(error: unknown): boolean {
  return classifyProviderError(error) === ProviderErrorKind.EXHAUSTED;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stringifies model content and strips reasoning traces (<think> blocks)
 * that reasoning models (e.g. NVIDIA Nemotron) prepend to their answers.
 */
export function contentToString(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Invokes a specific model with exponential-backoff retry on transient
 * failures. Returns the full response message (callers may need tool_calls).
 * Exposed for callers holding a bound model (e.g. the agent tool loop).
 */
export async function invokeModelWithRetry(
  model: InvocableModel,
  messages: BaseMessage[],
  queryId?: string,
  label: string = 'model',
): Promise<BaseMessage> {
  const traceLog = queryId ? withQueryId(log, queryId) : log;
  return invokeWithRetryInternal(model, messages, traceLog, label);
}

async function invokeWithRetryInternal(
  model: InvocableModel,
  messages: BaseMessage[],
  traceLog: Logger,
  label: string,
): Promise<BaseMessage> {
  for (let attempt = 1; ; attempt++) {
    try {
      const startTime = Date.now();
      const response = await model.invoke(messages);
      traceLog.debug('LLM invocation succeeded', {
        source: 'llmService#invokeWithRetryInternal',
        label,
        attempt,
        durationMs: Date.now() - startTime,
      });
      return response;
    } catch (error: unknown) {
      // Only transient blips are retried in place; exhaustion/fatal errors
      // propagate so the caller can fail over to another provider.
      if (attempt >= MAX_ATTEMPTS || classifyProviderError(error) !== ProviderErrorKind.RETRYABLE) throw error;

      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      traceLog.warn('Transient LLM error — retrying', {
        source: 'llmService#invokeWithRetryInternal',
        label,
        attempt,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }
}

/**
 * Invokes the best configured model for a role, walking the role's fallback
 * chain when a provider's retries are exhausted. Returns plain text content.
 */
export async function invokeForRole(
  role: ModelRole,
  messages: BaseMessage[],
  queryId?: string,
): Promise<string> {
  const traceLog = queryId ? withQueryId(log, queryId) : log;
  const chain = resolveRoleChain(role);
  let lastError: unknown;

  for (const { provider, model } of chain) {
    try {
      const response = await invokeWithRetryInternal(model, messages, traceLog, `${role}@${provider}`);
      return contentToString(response.content);
    } catch (error: unknown) {
      lastError = error;
      traceLog.warn('Provider exhausted for role — trying next in chain', {
        source: 'llmService#invokeForRole',
        role,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Invokes the configured LLM for general conversation with retry + fallback.
 * Back-compat wrapper over invokeForRole(CHAT).
 */
export async function invokeLLM(messages: BaseMessage[], queryId?: string): Promise<string> {
  return invokeForRole(ModelRole.CHAT, messages, queryId);
}
