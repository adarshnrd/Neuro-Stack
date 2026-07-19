import { ConfigService } from '@nestjs/config'
import { Logger, type Provider } from '@nestjs/common'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export const QWEN_LLM = 'QWEN_LLM'

/**
 * Factory provider for the single LLM used across all AI analysis
 * (commit effort/efficiency analysis and PR effort estimation).
 *
 * Dispatches on AI_MODEL_PROVIDER:
 *   'qwen' | 'alibaba' → Alibaba Dashscope (ChatAlibabaTongyi)
 *   anything else      → OpenAI-compatible endpoint (ChatOpenAI)
 *
 * The OpenAI-compatible branch is what the organization's **LiteLLM proxy**
 * uses: ChatOpenAI talks the OpenAI Chat Completions API, and pointing
 * `configuration.baseURL` at the LiteLLM endpoint routes every analysis call
 * through it (equivalent to `ChatOpenAI(openai_api_base=...)` in the Python SDK).
 * It also covers OpenAI/Anthropic-behind-LiteLLM, LM Studio, Ollama, etc.
 *
 * Both branches extend BaseChatModel — callers type the injection as BaseChatModel.
 */
export const QwenLlmProvider: Provider = {
  provide: QWEN_LLM,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService): Promise<BaseChatModel> => {
    const logger = new Logger('QwenLlmProvider')
    const provider = configService.get<string>('ai.provider', 'openai')
    const modelName = configService.get<string>('ai.modelName', 'qwen-plus')
    const temperature = configService.get<number>('ai.temperature', 0.1)
    const maxTokens = 2000

    if (provider === 'qwen' || provider === 'alibaba') {
      // Alibaba Dashscope — Qwen family models (native, not via LiteLLM)
      const { ChatAlibabaTongyi } = await import('@langchain/community/chat_models/alibaba_tongyi')
      logger.log(`AI provider: Alibaba Dashscope (model=${modelName || 'qwen-plus'})`)
      return new ChatAlibabaTongyi({
        model: modelName || 'qwen-plus',
        alibabaApiKey: configService.getOrThrow<string>('ai.alibabaApiKey'),
        temperature,
        maxTokens,
        streaming: false,
      }) as unknown as BaseChatModel
    }

    // ── OpenAI-compatible endpoint (LiteLLM proxy / OpenAI / local) ──────────────
    const { ChatOpenAI } = await import('@langchain/openai')

    // AI_CUSTOM_BASE_URL is the LiteLLM proxy base, e.g. http://192.168.10.13:4000
    // The OpenAI SDK appends "/chat/completions" to this base, matching the
    // LiteLLM REST contract (POST {base}/chat/completions).
    const baseURL = configService.get<string>('ai.customBaseUrl')
    // LiteLLM authenticates with a virtual key passed as the bearer token.
    const apiKey = configService.get<string>('ai.openaiApiKey') || 'sk-no-key'

    const openAiOptions: Record<string, unknown> = {
      apiKey,
      model: modelName,
      temperature,
      maxTokens,
    }

    if (baseURL) {
      openAiOptions['configuration'] = { baseURL }
      logger.log(
        `AI provider: OpenAI-compatible proxy (LiteLLM) at ${baseURL} (model=${modelName})`,
      )
    } else {
      logger.warn(
        'AI provider: defaulting to OpenAI public endpoint — no AI_CUSTOM_BASE_URL set. ' +
          'Set AI_CUSTOM_BASE_URL to the organization LiteLLM proxy URL to route analysis through it. ' +
          `(model=${modelName})`,
      )
    }

    return new ChatOpenAI(
      openAiOptions as unknown as ConstructorParameters<typeof ChatOpenAI>[0],
    ) as unknown as BaseChatModel
  },
}
