import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { invokeLLM } from '../llm/llmService.js';
import { config } from '../config/index.js';
import { createChildLogger, withQueryId } from '../logger/index.js';
import { parseUserInput } from '../commands/parser.js';
import { commandRegistry } from '../commands/registry.js';
import { CommandName } from '../enums/commandEnum.js';
import { ConversationRole } from '../enums/conversationEnum.js';
import { SYSTEM_PROMPT, CONVERSATION_HISTORY_LIMIT } from '../constants/chatConstants.js';
import { ChatResult } from '../types/chatTypes.js';
import { getRecentConversations } from '../database/conversationRepository.js';

const log = createChildLogger('chatService');

/**
 * Handles a user chat message:
 * 1. Parses for @commands and executes them via the CommandRegistry
 * 2. Otherwise invokes the LLM for a conversational AI response
 */
export async function handleChatMessage(
  message: string,
  sessionId: string,
  queryId?: string
): Promise<ChatResult> {
  const traceLog = queryId ? withQueryId(log, queryId) : log;
  const startTime = Date.now();
  traceLog.info('handleChatMessage entry', {
    source: 'chatService#handleChatMessage',
    sessionId,
    message
  });

  try {
    const parsed = parseUserInput(message, queryId);
    traceLog.debug('Message parse result', {
      source: 'chatService#handleChatMessage',
      isCommand: parsed.isCommand,
      command: parsed.command,
      argsKeys: Object.keys(parsed.args)
    });

    // ── Command branch ──
    if (parsed.isCommand && parsed.command) {
      const handler = commandRegistry.get(parsed.command as CommandName);

      if (handler) {
        traceLog.info(`Executing command: ${parsed.command}`, {
          source: 'chatService#handleChatMessage',
          sessionId
        });
        const result = await handler.execute(parsed.args, sessionId);

        traceLog.info('Command execution complete', {
          source: 'chatService#handleChatMessage',
          success: result.success,
          durationMs: Date.now() - startTime
        });

        // Successful command results with rich AI content are rendered as 'ai'
        // so the frontend applies streaming Markdown. Failures use 'system'.
        const responseType = result.success ? 'ai' : 'system';
        const typedData = result.data as Record<string, unknown> | undefined;
        return {
          type: responseType,
          content: result.message,
          changeSetId: typedData?.changeSetId as string | undefined,
          changesSummary: typedData?.changesSummary as ChatResult['changesSummary'],
        };
      }

      traceLog.warn(`Unknown command requested: ${parsed.command}`, { source: 'chatService#handleChatMessage' });
      return {
        type: 'system',
        content: `Unknown command: @${parsed.command}. Type @ to see available commands.`,
      };
    }

    // ── AI branch ──
    traceLog.info('Invoking LLM for chat response', {
      source: 'chatService#handleChatMessage',
      sessionId,
      provider: config.llm.provider,
      model: config.llm.model
    });

    // Fetch conversation history for multi-turn context
    const conversationHistory = await getRecentConversations(sessionId, CONVERSATION_HISTORY_LIMIT);

    traceLog.debug('Conversation history loaded', {
      source: 'chatService#handleChatMessage',
      historyCount: conversationHistory.length,
      sessionId,
    });

    // Build the messages array: system prompt → history → current message
    const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

    for (const entry of conversationHistory) {
      if (entry.role === ConversationRole.USER) {
        messages.push(new HumanMessage(entry.content));
      } else if (entry.role === ConversationRole.ASSISTANT) {
        messages.push(new AIMessage(entry.content));
      }
    }

    messages.push(new HumanMessage(message));

    const llmStartTime = Date.now();
    const content = await invokeLLM(messages, queryId);

    traceLog.debug('LLM response received', {
      source: 'chatService#handleChatMessage',
      llmDurationMs: Date.now() - llmStartTime,
    });

    traceLog.info('Chat execution complete', {
      source: 'chatService#handleChatMessage',
      contentLength: content.length,
      totalDurationMs: Date.now() - startTime
    });

    return { type: 'ai', content };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    traceLog.error('Chat service error', {
      source: 'chatService#handleChatMessage',
      error: message,
      stack,
      sessionId
    });
    return {
      type: 'error',
      content: `Sorry, I encountered an error: ${message}`,
    };
  }
}
