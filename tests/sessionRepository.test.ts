import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fake Supabase query builder. Every call is chainable and the builder is
 * awaitable; the result depends on whether the requested column list (or
 * update payload) touches `folder_path` while the column "doesn't exist".
 */
const { fakeDb } = vi.hoisted(() => ({
  fakeDb: {
    hasFolderColumn: false,
    selects: [] as string[],
    row: {
      id: '11111111-1111-4111-8111-111111111111',
      user_id: 'user-1',
      title: 'demo',
      is_active: true,
      status: 'active',
      created_at: '2026-10-19T00:00:00Z',
      last_active_at: '2026-10-19T00:00:00Z',
    } as Record<string, unknown>,
  },
}));

vi.mock('../src/database/supabaseClient.js', () => {
  const makeBuilder = () => {
    let columns = '';
    let payload: Record<string, unknown> = {};
    let single = false;
    const builder = {
      select: (cols: string) => { columns = cols; fakeDb.selects.push(cols); return builder; },
      insert: (values: Record<string, unknown>) => { payload = values; return builder; },
      update: (values: Record<string, unknown>) => { payload = values; return builder; },
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      single: () => { single = true; return builder; },
      then: (resolve: (value: unknown) => void) => {
        const touchesFolder = columns.includes('folder_path') || 'folder_path' in payload;
        if (touchesFolder && !fakeDb.hasFolderColumn) {
          const error = 'folder_path' in payload
            ? { code: 'PGRST204', message: "Could not find the 'folder_path' column of 'sessions' in the schema cache" }
            : { code: '42703', message: 'column sessions.folder_path does not exist' };
          return resolve({ data: null, error });
        }
        const row = fakeDb.hasFolderColumn ? { ...fakeDb.row, folder_path: payload.folder_path ?? null } : fakeDb.row;
        return resolve({ data: single ? row : [row], error: null });
      },
    };
    return builder;
  };
  return { getSupabaseClient: () => ({ from: () => makeBuilder() }) };
});

// The repository caches whether the column exists, so each test loads a fresh copy.
async function loadRepository() {
  vi.resetModules();
  return import('../src/database/sessionRepository.js');
}

describe('sessionRepository without migration 003 (no folder_path column)', () => {
  beforeEach(() => {
    fakeDb.hasFolderColumn = false;
    fakeDb.selects = [];
  });

  it('still lists, finds, and creates sessions (folderPath null)', async () => {
    const repository = await loadRepository();

    const sessions = await repository.listSessionsByUser('user-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].folderPath).toBeNull();

    const found = await repository.findSessionById(fakeDb.row.id as string);
    expect(found?.title).toBe('demo');

    const created = await repository.createSession('user-1');
    expect(created.id).toBe(fakeDb.row.id);

    // Only the first query probes the column; later ones skip it
    expect(fakeDb.selects.filter((cols) => cols.includes('folder_path'))).toHaveLength(1);
  });

  it('refuses to bind a folder with a clear "run the migration" error', async () => {
    const repository = await loadRepository();
    const { DatabaseSchemaError } = await import('../src/errors/databaseError.js');

    const attempt = repository.setSessionFolder(fakeDb.row.id as string, '/projects/app');
    await expect(attempt).rejects.toBeInstanceOf(DatabaseSchemaError);
    await expect(repository.setSessionFolder(fakeDb.row.id as string, '/projects/app')).rejects.toThrow(/003_session_folder\.sql/);
  });
});

describe('sessionRepository with migration 003', () => {
  beforeEach(() => {
    fakeDb.hasFolderColumn = true;
    fakeDb.selects = [];
  });

  it('reads and writes the session folder', async () => {
    const repository = await loadRepository();

    const updated = await repository.setSessionFolder(fakeDb.row.id as string, '/projects/app');
    expect(updated.folderPath).toBe('/projects/app');

    await repository.listSessionsByUser('user-1');
    expect(fakeDb.selects.every((cols) => cols.includes('folder_path'))).toBe(true);
  });
});
