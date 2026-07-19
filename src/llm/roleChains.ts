import { LLMProvider, ModelRole } from '../enums/index.js';

/**
 * Ordered provider preference per role. The first *configured* provider in the
 * chain is used; later entries are fallbacks when a provider fails or has no
 * credentials.
 *
 * Rationale:
 * - SUMMARIZER / VALIDATOR run every loop iteration → fastest/cheapest first (Groq)
 * - PLANNER / REVIEWER run once per iteration → highest-parameter reasoning model first
 *   (NVIDIA Ultra 550B), falling back to the 30B nano, then Gemini, then Groq. Quality here
 *   compounds through every downstream iteration, and the REVIEWER being a different family
 *   than the CODER counters self-review bias
 * - CHAT / CODER stay on Gemini (proven tool calling) with Groq next, then the NVIDIA 30B nano
 *   as a last-resort tool-capable fallback so a Gemini+Groq exhaustion continues rather than
 *   pausing. The 550B Ultra is deliberately kept OUT of these high-frequency roles — its
 *   per-call latency is fine once-per-task (plan/review) but far too slow for a tool loop
 * - SUMMARIZER / VALIDATOR never fall back to any NVIDIA reasoning model: too slow for the
 *   hot path, and Groq↔Gemini already covers them
 *
 * Pure data + pure resolution function — kept free of config imports for testability.
 */
export const ROLE_CHAINS: Record<ModelRole, LLMProvider[]> = {
  [ModelRole.CHAT]: [LLMProvider.GEMINI, LLMProvider.GROQ, LLMProvider.NVIDIA],
  [ModelRole.CODER]: [LLMProvider.GEMINI, LLMProvider.GROQ, LLMProvider.NVIDIA],
  [ModelRole.PLANNER]: [LLMProvider.NVIDIA_ULTRA, LLMProvider.NVIDIA, LLMProvider.GEMINI, LLMProvider.GROQ],
  [ModelRole.REVIEWER]: [LLMProvider.NVIDIA_ULTRA, LLMProvider.NVIDIA, LLMProvider.GEMINI, LLMProvider.GROQ],
  [ModelRole.SUMMARIZER]: [LLMProvider.GROQ, LLMProvider.GEMINI],
  [ModelRole.VALIDATOR]: [LLMProvider.GROQ, LLMProvider.GEMINI],
};

/** Per-role model options applied when instantiating the provider. */
export interface RoleOptions {
  temperature: number;
  enableThinking: boolean;
}

export const ROLE_OPTIONS: Record<ModelRole, RoleOptions> = {
  [ModelRole.CHAT]: { temperature: 0.7, enableThinking: false },
  [ModelRole.CODER]: { temperature: 0.2, enableThinking: false },
  [ModelRole.PLANNER]: { temperature: 0.6, enableThinking: true },
  [ModelRole.REVIEWER]: { temperature: 0.3, enableThinking: true },
  [ModelRole.SUMMARIZER]: { temperature: 0.3, enableThinking: false },
  [ModelRole.VALIDATOR]: { temperature: 0, enableThinking: false },
};

/**
 * Resolves the effective provider chain for a role given the set of providers
 * that actually have credentials configured.
 */
export function buildRoleChain(role: ModelRole, available: ReadonlySet<LLMProvider>): LLMProvider[] {
  return ROLE_CHAINS[role].filter((provider) => available.has(provider));
}
