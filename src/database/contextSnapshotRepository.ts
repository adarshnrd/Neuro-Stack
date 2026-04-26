import { getSupabaseClient } from './supabaseClient.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('contextSnapshotRepository');

export interface ContextSnapshot {
  id: string;
  sessionId: string;
  summary: string;
  createdAt: string;
}

/**
 * Saves a context summary snapshot for a session.
 */
export async function saveSnapshot(sessionId: string, summary: string): Promise<ContextSnapshot> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('context_snapshots')
    .insert({ session_id: sessionId, summary })
    .select('id, session_id, summary, created_at')
    .single();

  if (error) {
    log.error('Failed to save context snapshot', {
      source: 'contextSnapshotRepository#saveSnapshot',
      error: error.message,
      sessionId,
    });
    throw new Error(`Failed to save context snapshot: ${error.message}`);
  }

  return {
    id: data.id,
    sessionId: data.session_id,
    summary: data.summary,
    createdAt: data.created_at,
  };
}

/**
 * Returns the latest context snapshot for a session, or null.
 */
export async function getLatestSnapshot(sessionId: string): Promise<ContextSnapshot | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('context_snapshots')
    .select('id, session_id, summary, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    log.error('Failed to get latest snapshot', {
      source: 'contextSnapshotRepository#getLatestSnapshot',
      error: error.message,
    });
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    sessionId: data.session_id,
    summary: data.summary,
    createdAt: data.created_at,
  };
}
