import { insertConversation } from '../database/conversationRepository.js';
import { ChatResult } from '../types/chatTypes.js';
import { createChildLogger } from '../logger/index.js';
import { ConversationRole } from '../enums/conversationEnum.js';

const log = createChildLogger('conversationPersistenceService');

/**
 * Records a complete user→AI exchange to the conversations table.
 * Called after handleChatMessage() returns, preserving the full
 * original response shape including type, changeSetId, and changesSummary.
 *
 * This is intentionally fire-and-forget friendly — a failed DB write
 * should never break the chat flow.
 */
export async function recordExchange(
  sessionId: string,
  userId: string,
  userMessage: string,
  response: ChatResult,
): Promise<void> {
  try {
    // 1. Persist the user message
    await insertConversation({
      sessionId,
      userId,
      role: ConversationRole.USER,
      content: userMessage,
      responseType: undefined,
    });

    // 2. Persist the AI/system/error response with full metadata
    const metadata: Record<string, unknown> = {};
    if (response.changeSetId) metadata.changeSetId = response.changeSetId;
    if (response.changesSummary) metadata.changesSummary = response.changesSummary;

    const role = response.type === 'error' ? ConversationRole.ERROR
      : response.type === 'system' ? ConversationRole.SYSTEM
      : ConversationRole.ASSISTANT;

    await insertConversation({
      sessionId,
      userId,
      role,
      content: response.content,
      responseType: response.type,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    log.debug('Exchange recorded', {
      source: 'conversationPersistenceService#recordExchange',
      sessionId,
      responseType: response.type,
    });
  } catch (error: unknown) {
    // Non-fatal: log but do not re-throw so chat flow is unaffected
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to persist conversation exchange', {
      source: 'conversationPersistenceService#recordExchange',
      error: message,
      sessionId,
    });
  }
}
