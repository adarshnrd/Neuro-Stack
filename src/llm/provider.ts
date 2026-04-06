import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LLMConfig } from '../types/index.js';
import { LLMProvider } from '../enums/index.js';
import { createGeminiProvider } from './providers/geminiProvider.js';

export function createLLMProvider(config: LLMConfig): BaseChatModel {
  switch (config.provider as LLMProvider) {
    case LLMProvider.GEMINI:
      return createGeminiProvider(config);
    case LLMProvider.OPENAI:
      throw new Error('OpenAI provider not yet implemented phase 1');
    default:
      // Default to gemini if unrecognized but we would normally throw
      return createGeminiProvider(config);
  }
}
