import { ConversationRole } from '../enums/conversationEnum.js';
export { ConversationRole };

export interface ConversationRecord {
  id: string;
  sessionId: string;
  userId: string;
  role: ConversationRole;
  content: string;
  responseType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedConversations {
  conversations: ConversationRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}
