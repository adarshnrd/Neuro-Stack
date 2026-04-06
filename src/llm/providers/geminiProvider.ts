import { ChatGoogle } from '@langchain/google';
import { LLMConfig } from '../../types/index.js';

export function createGeminiProvider(config: LLMConfig): ChatGoogle {
  return new ChatGoogle({
    model: config.model || 'gemini-2.5-flash',
    apiKey: config.apiKey,
    // Add additional gemini specific logic here if needed
  });
}
