import { ChatGoogle } from '@langchain/google';
import { LLMConfig } from '../../types/index.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('geminiProvider');

export function createGeminiProvider(config: LLMConfig): ChatGoogle {
  log.debug('Instantiating ChatGoogle', { 
    source: 'geminiProvider#createGeminiProvider',
    model: config.model || 'gemini-2.5-flash',
    hasApiKey: !!config.apiKey
  });

  return new ChatGoogle({
    model: config.model || 'gemini-2.5-flash',
    apiKey: config.apiKey,
    // Add additional gemini specific logic here if needed
  });
}
