import { registerAs } from '@nestjs/config'

export default registerAs('ai', () => ({
  provider: process.env.AI_MODEL_PROVIDER ?? 'openai',
  modelName: process.env.AI_MODEL_NAME ?? 'qwen-plus',
  temperature: parseFloat(process.env.AI_TEMPERATURE ?? '0.1'),
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  alibabaApiKey: process.env.ALIBABA_API_KEY,
  /** Base URL for local/custom OpenAI-compatible endpoints (LM Studio, Ollama, etc.) */
  customBaseUrl: process.env.AI_CUSTOM_BASE_URL,
}))
