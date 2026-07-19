import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LLMProvider, ModelRole } from '../enums/index.js';
import { config } from '../config/index.js';
import { createGeminiProvider } from './providers/geminiProvider.js';
import { createGroqProvider } from './providers/groqProvider.js';
import { createNvidiaProvider } from './providers/nvidiaProvider.js';
import { buildRoleChain, ROLE_OPTIONS } from './roleChains.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('modelRouter');

export interface RoleModelEntry {
  provider: LLMProvider;
  model: BaseChatModel;
}

// Models are stateless clients — one instance per provider+role pair is reused
const modelCache = new Map<string, BaseChatModel>();

function availableProviders(): Set<LLMProvider> {
  const available = new Set<LLMProvider>();
  if (config.llm.apiKey) available.add(LLMProvider.GEMINI);
  if (config.llmProviders.groq) available.add(LLMProvider.GROQ);
  if (config.llmProviders.nvidia) available.add(LLMProvider.NVIDIA);
  if (config.llmProviders.nvidiaUltra) available.add(LLMProvider.NVIDIA_ULTRA);
  return available;
}

function instantiate(provider: LLMProvider, role: ModelRole): BaseChatModel {
  const opts = ROLE_OPTIONS[role];
  switch (provider) {
    case LLMProvider.GEMINI:
      return createGeminiProvider(config.llm);
    case LLMProvider.GROQ:
      return createGroqProvider(config.llmProviders.groq!, { temperature: opts.temperature });
    case LLMProvider.NVIDIA:
      return createNvidiaProvider(config.llmProviders.nvidia!, {
        temperature: opts.temperature,
        enableThinking: opts.enableThinking,
      });
    case LLMProvider.NVIDIA_ULTRA:
      return createNvidiaProvider(config.llmProviders.nvidiaUltra!, {
        temperature: opts.temperature,
        enableThinking: opts.enableThinking,
      });
    default:
      throw new Error(`Provider not implemented: ${provider}`);
  }
}

function getModel(provider: LLMProvider, role: ModelRole): BaseChatModel {
  const key = `${provider}:${role}`;
  let model = modelCache.get(key);
  if (!model) {
    model = instantiate(provider, role);
    modelCache.set(key, model);
  }
  return model;
}

/**
 * Returns the ordered list of instantiated models for a role — first entry is
 * the preferred provider, the rest are fallbacks.
 */
export function resolveRoleChain(role: ModelRole): RoleModelEntry[] {
  const chain = buildRoleChain(role, availableProviders());
  if (chain.length === 0) {
    log.error('No provider configured for role', { source: 'modelRouter#resolveRoleChain', role });
    throw new Error(`No configured provider available for role: ${role}`);
  }
  return chain.map((provider) => ({ provider, model: getModel(provider, role) }));
}

/** The preferred (first available) model for a role, e.g. for tool binding. */
export function getModelForRole(role: ModelRole): RoleModelEntry {
  return resolveRoleChain(role)[0];
}
