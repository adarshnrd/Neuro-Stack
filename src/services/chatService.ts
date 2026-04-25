import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLMProvider } from '../llm/provider.js';
import { config } from '../config/index.js';
import { createChildLogger, withQueryId } from '../logger/index.js';
import { parseUserInput } from '../commands/parser.js';
import { commandRegistry } from '../commands/registry.js';
import { CommandName } from '../enums/commandEnum.js';
import { SYSTEM_PROMPT } from '../constants/chatConstants.js';
import { ChatResult } from '../types/chatTypes.js';
import { CommandResult } from '../types/commandTypes.js';

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
        const typedData = result.data as Record<string, any> | undefined;
        return { 
          type: responseType, 
          content: result.message,
          changeSetId: typedData?.changeSetId,
          changesSummary: typedData?.changesSummary
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

    const llmStartTime = Date.now();
    const llm = createLLMProvider(config.llm);

    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(message),
    ]);
    
    traceLog.debug('LLM response received', {
      source: 'chatService#handleChatMessage',
      llmDurationMs: Date.now() - llmStartTime,
    });

    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    traceLog.info('Chat execution complete', {
      source: 'chatService#handleChatMessage',
      contentLength: content.length,
      content,
      totalDurationMs: Date.now() - startTime
    });

    return { type: 'ai', content };
  } catch (error: any) {
    traceLog.error('Chat service error', { 
      source: 'chatService#handleChatMessage',
      error: error.message, 
      stack: error.stack,
      sessionId 
    });
    return {
      type: 'error',
      content: `Sorry, I encountered an error: ${error.message}`,
    };
  }
}
