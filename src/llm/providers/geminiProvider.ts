import { ChatGoogle } from '@langchain/google';
import { LLMConfig } from '../../types/index.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('geminiProvider');

export interface GeminiProviderOptions {
  temperature?: number;
}

export function createGeminiProvider(config: LLMConfig, options: GeminiProviderOptions = {}): ChatGoogle {
  log.debug('Instantiating ChatGoogle', {
    source: 'geminiProvider#createGeminiProvider',
    model: config.model || 'gemini-2.5-flash',
    temperature: options.temperature,
    hasApiKey: !!config.apiKey,
  });

  return new ChatGoogle({
    model: config.model || 'gemini-2.5-flash',
    apiKey: config.apiKey,
    // Role temperature (e.g. 0.2 for CODER, 0 for VALIDATOR); provider default when unset
    temperature: options.temperature,
  });
}
