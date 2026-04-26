import { getSupabaseClient } from './supabaseClient.js';
import { createChildLogger } from '../logger/index.js';
import { SessionRecord } from '../types/sessionTypes.js';

const log = createChildLogger('sessionRepository');

/**
 * Creates a new session row in the database.
 */
export async function createSession(userId: string, title?: string): Promise<SessionRecord> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: userId, title: title || null })
    .select('id, user_id, title, is_active, status, created_at, last_active_at')
    .single();

  if (error) {
    log.error('Failed to create session', { source: 'sessionRepository#createSession', error: error.message });
    throw new Error(`Failed to create session: ${error.message}`);
  }

  log.info('Session created', { source: 'sessionRepository#createSession', sessionId: data.id, userId });

  return mapRow(data);
}

/**
 * Finds a session by ID. Returns null if not found.
 */
export async function findSessionById(sessionId: string): Promise<SessionRecord | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('sessions')
    .select('id, user_id, title, is_active, status, created_at, last_active_at')
    .eq('id', sessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    log.error('Failed to find session', { source: 'sessionRepository#findSessionById', error: error.message });
    throw new Error(`Failed to find session: ${error.message}`);
  }

  return data ? mapRow(data) : null;
}

/**
 * Lists all sessions for a given user, newest first.
 */
export async function listSessionsByUser(userId: string): Promise<SessionRecord[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('sessions')
    .select('id, user_id, title, is_active, status, created_at, last_active_at')
    .eq('user_id', userId)
    .order('last_active_at', { ascending: false });

  if (error) {
    log.error('Failed to list sessions', { source: 'sessionRepository#listSessionsByUser', error: error.message });
    throw new Error(`Failed to list sessions: ${error.message}`);
  }

  return (data || []).map(mapRow);
}

/**
 * Updates a session's title and last_active_at timestamp.
 */
export async function updateSession(
  sessionId: string,
  updates: { title?: string; isActive?: boolean; status?: string; lastActiveAt?: string },
): Promise<void> {
  const supabase = getSupabaseClient();

  const payload: Record<string, unknown> = { last_active_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;
  if (updates.status !== undefined) payload.status = updates.status;

  const { error } = await supabase
    .from('sessions')
    .update(payload)
    .eq('id', sessionId);

  if (error) {
    log.error('Failed to update session', { source: 'sessionRepository#updateSession', error: error.message });
    throw new Error(`Failed to update session: ${error.message}`);
  }

  log.debug('Session updated', { source: 'sessionRepository#updateSession', sessionId });
}

/**
 * Touch the session's last_active_at timestamp.
 */
export async function touchSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    log.error('Failed to touch session', { source: 'sessionRepository#touchSession', error: error.message });
  }
}

// ── Internal mapper ────────────────────────────────────────────────────────────

function mapRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: (row.title as string) || null,
    isActive: row.is_active as boolean,
    status: row.status as string,
    createdAt: row.created_at as string,
    lastActiveAt: row.last_active_at as string,
  };
}
