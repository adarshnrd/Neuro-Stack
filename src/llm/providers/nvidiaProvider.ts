import { ChatOpenAI } from '@langchain/openai';
import { ProviderCredentials } from '../../types/index.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('nvidiaProvider');

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface NvidiaProviderOptions {
  temperature?: number;
  maxTokens?: number;
  /** Enables the model's reasoning ("thinking") mode — slower but deeper. */
  enableThinking?: boolean;
}

/**
 * NVIDIA NIM (build.nvidia.com) — OpenAI-compatible endpoint hosting large
 * reasoning models. Used for once-per-iteration roles (planning, review)
 * where depth matters more than latency.
 */
export function createNvidiaProvider(creds: ProviderCredentials, options: NvidiaProviderOptions = {}): ChatOpenAI {
  log.debug('Instantiating NVIDIA ChatOpenAI', {
    source: 'nvidiaProvider#createNvidiaProvider',
    model: creds.model,
    enableThinking: options.enableThinking ?? false,
  });

  return new ChatOpenAI({
    model: creds.model,
    apiKey: creds.apiKey,
    temperature: options.temperature ?? 0.6,
    maxTokens: options.maxTokens ?? 8192,
    configuration: { baseURL: NVIDIA_BASE_URL },
    modelKwargs: {
      chat_template_kwargs: { enable_thinking: options.enableThinking ?? false },
    },
  });
}
