export enum LLMProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GROQ = 'groq',
  NVIDIA = 'nvidia',
  /** NVIDIA NIM, highest-parameter reasoning model (Nemotron Ultra). */
  NVIDIA_ULTRA = 'nvidia_ultra',
}

/**
 * Functional role a model plays in the agent workflow.
 * Each role resolves to an ordered provider chain (see llm/roleChains.ts) so the
 * best-suited configured model is used, with automatic fallback on provider errors.
 */
export enum ModelRole {
  /** General conversational responses */
  CHAT = 'chat',
  /** Tool-calling implementation loop */
  CODER = 'coder',
  /** Task analysis and implementation planning */
  PLANNER = 'planner',
  /** Diff-vs-requirements gap analysis (kept on a different family than CODER) */
  REVIEWER = 'reviewer',
  /** Doc digestion and transcript compression */
  SUMMARIZER = 'summarizer',
  /** Structured verdicts against acceptance criteria */
  VALIDATOR = 'validator',
}
