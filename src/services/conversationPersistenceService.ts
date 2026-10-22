import { insertConversation } from '../database/conversationRepository.js';
import { setSessionTitleIfEmpty, touchSession } from '../database/sessionRepository.js';
import { truncateText } from '../utils/stringUtil.js';
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

/**
 * Records a folder-agent run started from the chat UI as a normal exchange, so
 * it shows up in the session's history: the prompt (tagged with the folder) as
 * the user turn, the agent's final report as the assistant turn. Also names an
 * untitled session after the prompt. Never throws.
 */
export async function recordFolderRunExchange(
  sessionId: string,
  userId: string,
  folder: string,
  prompt: string | null,
  response: ChatResult,
): Promise<void> {
  const userMessage = prompt
    ? `📁 ${folder}\n\n${prompt}`
    : `📁 ${folder}\n\n⟳ Resume the interrupted run`;

  try {
    await setSessionTitleIfEmpty(sessionId, truncateText(prompt ?? `Resume in ${folder}`, 50));
    await recordExchange(sessionId, userId, userMessage, response);
    await touchSession(sessionId);
  } catch (error: unknown) {
    log.error('Failed to persist folder-agent exchange', {
      source: 'conversationPersistenceService#recordFolderRunExchange',
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
