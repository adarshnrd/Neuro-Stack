import { BaseMessage } from '@langchain/core/messages';
import { Logger } from 'winston';
import { config } from '../config/index.js';
import { ModelRole } from '../enums/index.js';
import { resolveRoleChain } from './modelRouter.js';
import { createChildLogger, withQueryId } from '../logger/index.js';

const log = createChildLogger('llmService');

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/** Anything with a message-array invoke — a chat model or a tool-bound runnable. */
export interface InvocableModel {
  invoke(messages: BaseMessage[], options?: { timeout?: number }): Promise<BaseMessage>;
}

/**
 * How to react to a provider error:
 * - RETRYABLE: transient blip → back off and retry the SAME provider.
 * - EXHAUSTED: quota / rate-limit / context-overflow → stop retrying, fail over
 *   to the next provider in the chain (a different model).
 * - UNAUTHORIZED: bad / revoked API key → this provider is unusable; fail over
 *   to the next one instead of killing the run.
 * - FATAL: bad request / anything unrecognised → neither retry nor fail over; surface it.
 */
export enum ProviderErrorKind {
  RETRYABLE = 'retryable',
  EXHAUSTED = 'exhausted',
  UNAUTHORIZED = 'unauthorized',
  FATAL = 'fatal',
}

const EXHAUSTED_RE =
  /quota|exceeded your current quota|rate.?limit|too many requests|429|resource[_ ]?exhausted|tokens per (minute|day)|\bTPM\b|\bRPM\b|\bRPD\b|request too large|context length|maximum context|context window|too many tokens|\b413\b/i;
const RETRYABLE_RE =
  /high demand|overloaded|\b502\b|\b503\b|\b504\b|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|network|aborted due to timeout|TimeoutError|timed? ?out/i;

const UNAUTHORIZED_RE =
  /\b401\b|\b403\b|invalid[_ ]api[_ ]key|api key not valid|incorrect api key|unauthori[sz]ed|permission[_ ]denied|authentication/i;

export function classifyProviderError(error: unknown): ProviderErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (EXHAUSTED_RE.test(message)) return ProviderErrorKind.EXHAUSTED;
  if (UNAUTHORIZED_RE.test(message)) return ProviderErrorKind.UNAUTHORIZED;
  if (RETRYABLE_RE.test(message)) return ProviderErrorKind.RETRYABLE;
  return ProviderErrorKind.FATAL;
}

/** True when the error means the current provider is out of capacity (should fail over). */
export function isExhaustionError(error: unknown): boolean {
  return classifyProviderError(error) === ProviderErrorKind.EXHAUSTED;
}

/** True when a different provider might succeed: this one is out of capacity or its key is unusable. */
export function shouldFailOver(error: unknown): boolean {
  const kind = classifyProviderError(error);
  return kind === ProviderErrorKind.EXHAUSTED || kind === ProviderErrorKind.UNAUTHORIZED;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turns model content into plain text and strips reasoning traces (<think>
 * blocks) that reasoning models (e.g. NVIDIA Nemotron) prepend to answers.
 * Block-form content (e.g. Gemini's `[{ type: 'text', text, thoughtSignature }]`)
 * is reduced to its text parts; anything without text falls back to JSON.
 */
export function contentToString(content: unknown): string {
  const text = typeof content === 'string' ? content : extractBlockText(content) ?? JSON.stringify(content);
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function extractBlockText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const textParts = content
    .map((block: unknown) => {
      if (typeof block === 'string') return block;
      if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean);
  return textParts.length > 0 ? textParts.join('\n') : null;
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
      // A hung provider must not stall the request forever — a timeout is retried like a network blip
      const response = await model.invoke(messages, { timeout: config.llm.timeoutMs });
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
