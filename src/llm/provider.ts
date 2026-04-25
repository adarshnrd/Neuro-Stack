import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LLMConfig } from '../types/index.js';
import { LLMProvider } from '../enums/index.js';
import { createGeminiProvider } from './providers/geminiProvider.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('llmProvider');

export function createLLMProvider(config: LLMConfig): BaseChatModel {
  log.info('Creating LLM provider', { source: 'provider#createLLMProvider', provider: config.provider, model: config.model });
  
  switch (config.provider as LLMProvider) {
    case LLMProvider.GEMINI:
      return createGeminiProvider(config);
    case LLMProvider.OPENAI:
      log.error('OpenAI provider not yet implemented', { source: 'provider#createLLMProvider' });
      throw new Error('OpenAI provider not yet implemented phase 1');
    default:
      log.warn('Unrecognized provider, falling back to default', { source: 'provider#createLLMProvider', fallback: LLMProvider.GEMINI });
      // Default to gemini if unrecognized but we would normally throw
      return createGeminiProvider(config);
  }
}
