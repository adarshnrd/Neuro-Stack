import { getSupabaseClient } from './supabaseClient.js';
import { createChildLogger } from '../logger/index.js';
import { ConversationRecord, PaginatedConversations, ConversationRole } from '../types/conversationTypes.js';

const log = createChildLogger('conversationRepository');

/**
 * Inserts a single conversation message row.
 */
export async function insertConversation(params: {
  sessionId: string;
  userId: string;
  role: ConversationRole;
  content: string;
  responseType?: string;
  metadata?: Record<string, unknown>;
}): Promise<ConversationRecord> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      session_id: params.sessionId,
      user_id: params.userId,
      role: params.role,
      content: params.content,
      response_type: params.responseType || null,
      metadata: params.metadata || {},
    })
    .select('id, session_id, user_id, role, content, response_type, metadata, created_at')
    .single();

  if (error) {
    log.error('Failed to insert conversation', {
      source: 'conversationRepository#insertConversation',
      error: error.message,
      sessionId: params.sessionId,
    });
    throw new Error(`Failed to insert conversation: ${error.message}`);
  }

  return mapRow(data);
}

/**
 * Fetches conversations for a session with cursor-based pagination.
 * Returns the most recent messages first, reversed client-side for display order.
 *
 * @param sessionId - The session to fetch conversations for
 * @param limit     - Number of messages to return (default 10)
 * @param cursor    - ID of the oldest message from the previous page; fetches older messages
 */
export async function getConversationsPaginated(
  sessionId: string,
  limit: number = 10,
  cursor?: string,
): Promise<PaginatedConversations> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('conversations')
    .select('id, session_id, user_id, role, content, response_type, metadata, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit + 1); // Fetch one extra to determine hasMore

  if (cursor) {
    // Get the created_at of the cursor message to paginate from
    const { data: cursorRow } = await supabase
      .from('conversations')
      .select('created_at')
      .eq('id', cursor)
      .single();

    if (cursorRow) {
      query = query.lt('created_at', cursorRow.created_at);
    }
  }

  const { data, error } = await query;

  if (error) {
    log.error('Failed to fetch conversations', {
      source: 'conversationRepository#getConversationsPaginated',
      error: error.message,
      sessionId,
    });
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // Reverse so oldest is first (chronological order for display)
  const conversations = pageRows.map(mapRow).reverse();

  const nextCursor = hasMore && pageRows.length > 0
    ? pageRows[pageRows.length - 1].id
    : null;

  return { conversations, nextCursor, hasMore };
}

/**
 * Returns the total number of conversations in a session.
 */
export async function getConversationCount(sessionId: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (error) {
    log.error('Failed to count conversations', {
      source: 'conversationRepository#getConversationCount',
      error: error.message,
    });
    return 0;
  }

  return count ?? 0;
}

// ── Internal mapper ────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): ConversationRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    userId: row.user_id as string,
    role: row.role as ConversationRecord['role'],
    content: row.content as string,
    responseType: (row.response_type as string) || null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: row.created_at as string,
  };
}
