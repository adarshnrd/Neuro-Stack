import { PostgrestError } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient.js';
import { createChildLogger } from '../logger/index.js';
import { DatabaseSchemaError } from '../errors/databaseError.js';
import { SessionRecord } from '../types/sessionTypes.js';
import { isUuid } from '../utils/stringUtil.js';

const log = createChildLogger('sessionRepository');

const BASE_SESSION_COLUMNS = 'id, user_id, title, is_active, status, created_at, last_active_at';
const FOLDER_MIGRATION = '003_session_folder.sql';

// sessions.folder_path comes from migration 003. Until it is applied, sessions
// keep working (without per-session folders) instead of every query failing.
let hasFolderColumn = true;

function sessionColumns(): string {
  return hasFolderColumn ? `${BASE_SESSION_COLUMNS}, folder_path` : BASE_SESSION_COLUMNS;
}

/** Postgres (42703) or PostgREST's schema cache (PGRST204) rejecting the not-yet-migrated column. */
function isMissingFolderColumn(error: PostgrestError | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204') && error.message.includes('folder_path');
}

/** Raw sessions row; the column list is built at runtime, so supabase-js can't infer it. */
type SessionRow = Record<string, unknown>;

/** Runs a session query; if the folder column is missing, retries it without that column. */
async function queryWithFolderFallback(
  runQuery: (columns: string) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<{ data: unknown; error: PostgrestError | null }> {
  const result = await runQuery(sessionColumns());
  if (!isMissingFolderColumn(result.error)) return result;

  hasFolderColumn = false;
  log.warn(`sessions.folder_path is missing — run ${FOLDER_MIGRATION}; per-session folders are disabled until then`, {
    source: 'sessionRepository#queryWithFolderFallback',
  });
  return runQuery(sessionColumns());
}

/**
 * Creates a new session row in the database.
 */
export async function createSession(userId: string, title?: string): Promise<SessionRecord> {
  const supabase = getSupabaseClient();

  // A failed insert+select is rolled back as one request, so the retry can't create a duplicate
  const { data, error } = await queryWithFolderFallback((columns) =>
    supabase.from('sessions').insert({ user_id: userId, title: title || null }).select(columns).single(),
  );

  if (error) {
    log.error('Failed to create session', { source: 'sessionRepository#createSession', error: error.message });
    throw new Error(`Failed to create session: ${error.message}`);
  }

  const session = mapRow(data as SessionRow);
  log.info('Session created', { source: 'sessionRepository#createSession', sessionId: session.id, userId });
  return session;
}

/**
 * Finds a session by ID. Returns null if not found.
 */
export async function findSessionById(sessionId: string): Promise<SessionRecord | null> {
  // sessions.id is a uuid column — Postgres errors on anything else, which
  // would surface as a 500 instead of a clean "not found".
  if (!isUuid(sessionId)) return null;
  const supabase = getSupabaseClient();

  const { data, error } = await queryWithFolderFallback((columns) =>
    supabase.from('sessions').select(columns).eq('id', sessionId).single(),
  );

  if (error) {
    if (error.code === 'PGRST116') return null;
    log.error('Failed to find session', { source: 'sessionRepository#findSessionById', error: error.message });
    throw new Error(`Failed to find session: ${error.message}`);
  }

  return data ? mapRow(data as SessionRow) : null;
}

/**
 * Lists all sessions for a given user, newest first.
 */
export async function listSessionsByUser(userId: string): Promise<SessionRecord[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await queryWithFolderFallback((columns) =>
    supabase.from('sessions').select(columns).eq('user_id', userId).order('last_active_at', { ascending: false }),
  );

  if (error) {
    log.error('Failed to list sessions', { source: 'sessionRepository#listSessionsByUser', error: error.message });
    throw new Error(`Failed to list sessions: ${error.message}`);
  }

  return ((data as SessionRow[] | null) ?? []).map(mapRow);
}

/**
 * Sets a session's title only if it has not been set yet.
 * The conditional update is atomic — no read-then-write race when
 * multiple "first" messages arrive concurrently.
 */
export async function setSessionTitleIfEmpty(sessionId: string, title: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('sessions')
    .update({ title, last_active_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('title', null);

  if (error) {
    log.error('Failed to set session title', { source: 'sessionRepository#setSessionTitleIfEmpty', error: error.message });
  }
}

/**
 * Binds a session to a local project folder (or clears it with null). Prompts in
 * the session then run the folder agent there. Returns the updated session.
 */
export async function setSessionFolder(sessionId: string, folderPath: string | null): Promise<SessionRecord> {
  const supabase = getSupabaseClient();

  // Always attempts the column, so applying the migration takes effect without a restart
  const { data, error } = await supabase
    .from('sessions')
    .update({ folder_path: folderPath, last_active_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select(`${BASE_SESSION_COLUMNS}, folder_path`)
    .single();

  if (isMissingFolderColumn(error)) {
    hasFolderColumn = false;
    log.error('Cannot bind folder — migration not applied', { source: 'sessionRepository#setSessionFolder', sessionId });
    throw new DatabaseSchemaError(FOLDER_MIGRATION);
  }
  if (error) {
    log.error('Failed to set session folder', { source: 'sessionRepository#setSessionFolder', sessionId, error: error.message });
    throw new Error(`Failed to set session folder: ${error.message}`);
  }

  hasFolderColumn = true;
  log.info('Session folder updated', { source: 'sessionRepository#setSessionFolder', sessionId, folderPath });
  return mapRow(data);
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

function mapRow(row: SessionRow): SessionRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: (row.title as string) || null,
    isActive: row.is_active as boolean,
    status: row.status as string,
    folderPath: (row.folder_path as string) || null,
    createdAt: row.created_at as string,
    lastActiveAt: row.last_active_at as string,
  };
}
