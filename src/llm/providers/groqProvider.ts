import { ChatGroq } from '@langchain/groq';
import { ProviderCredentials } from '../../types/index.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('groqProvider');

export interface GroqProviderOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Groq — open-weight models on LPU hardware. Fast and cheap, used for
 * high-frequency roles (summarization, structured verdicts) and as a
 * fallback when other providers are unavailable.
 */
export function createGroqProvider(creds: ProviderCredentials, options: GroqProviderOptions = {}): ChatGroq {
  log.debug('Instantiating ChatGroq', {
    source: 'groqProvider#createGroqProvider',
    model: creds.model,
  });

  return new ChatGroq({
    model: creds.model,
    apiKey: creds.apiKey,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 4096,
  });
}
