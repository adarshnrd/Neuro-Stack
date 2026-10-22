import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import fs from 'fs/promises';
import path from 'path';

// vi.mock factories are hoisted above imports, so shared values must be hoisted too.
const { BROWSE_ROOT, OWNED_SESSION, FOREIGN_SESSION, BOUND_ELSEWHERE_SESSION } = vi.hoisted(() => ({
  // Confine the folder agent to a temp root (the real default is the home dir).
  BROWSE_ROOT: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/ns-folder-routes-${process.pid}`,
  OWNED_SESSION: '11111111-1111-4111-8111-111111111111',
  FOREIGN_SESSION: '22222222-2222-4222-8222-222222222222',
  BOUND_ELSEWHERE_SESSION: '33333333-3333-4333-8333-333333333333',
}));

vi.mock('../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/index.js')>();
  return { config: { ...actual.config, folderAgent: { browseRoot: path.resolve(BROWSE_ROOT) } } };
});

vi.mock('../src/database/sessionRepository.js', () => ({
  findSessionById: vi.fn(async (sessionId: string) => {
    if (sessionId === OWNED_SESSION) return { id: sessionId, userId: 'admin-1' };
    if (sessionId === FOREIGN_SESSION) return { id: sessionId, userId: 'someone-else' };
    if (sessionId === BOUND_ELSEWHERE_SESSION) {
      return { id: sessionId, userId: 'admin-1', folderPath: path.resolve(BROWSE_ROOT, 'other-project') };
    }
    return null;
  }),
  setSessionFolder: vi.fn(async (sessionId: string, folderPath: string | null) => ({ id: sessionId, userId: 'admin-1', folderPath })),
  createSession: vi.fn(),
  listSessionsByUser: vi.fn(),
  touchSession: vi.fn(),
  setSessionTitleIfEmpty: vi.fn(),
}));

vi.mock('../src/services/conversationPersistenceService.js', () => ({
  recordFolderRunExchange: vi.fn(async () => undefined),
}));

vi.mock('../src/services/folderAgentService.js', () => ({
  runFolderAgent: vi.fn(async (_folder: string, _prompt: string, options: { onProgress?: (event: unknown) => void }) => {
    options.onProgress?.({ type: 'round', message: 'Round 1: write_file' });
    return { content: 'All done.', status: 'complete', handoffCount: 0 };
  }),
  resumeFolderAgent: vi.fn(),
  getFolderStatus: vi.fn(async () => 'status'),
}));

import folderRoutes from '../src/web/routes/folderRoutes.js';
import apiRoutes from '../src/web/routes/apiRoutes.js';
import { setSessionFolder } from '../src/database/sessionRepository.js';
import { recordFolderRunExchange } from '../src/services/conversationPersistenceService.js';
import { runFolderAgent } from '../src/services/folderAgentService.js';

let server: Server;
let baseUrl: string;
let currentRole = 'admin';

beforeAll(async () => {
  await fs.mkdir(path.join(path.resolve(BROWSE_ROOT), 'project'), { recursive: true });

  const app = express();
  app.use(express.json());
  // Stand-in for authMiddleware: an authenticated user whose role each test controls
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'admin-1';
    req.userRole = currentRole;
    next();
  });
  app.use(folderRoutes);
  app.use(apiRoutes);

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await fs.rm(BROWSE_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  currentRole = 'admin';
  vi.mocked(recordFolderRunExchange).mockClear();
  vi.mocked(runFolderAgent).mockClear();
  vi.mocked(setSessionFolder).mockClear();
});

const postRun = (body: Record<string, unknown>) =>
  fetch(`${baseUrl}/api/folder/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/folder/run', () => {
  it('rejects non-admin users', async () => {
    currentRole = 'user';
    const res = await postRun({ path: path.join(BROWSE_ROOT, 'project'), prompt: 'x' });
    expect(res.status).toBe(403);
    expect(runFolderAgent).not.toHaveBeenCalled();
  });

  it('rejects folders outside FOLDER_AGENT_ROOT', async () => {
    const res = await postRun({ path: path.dirname(path.resolve(BROWSE_ROOT)), prompt: 'x' });
    expect(res.status).toBe(400);
    expect(runFolderAgent).not.toHaveBeenCalled();
  });

  it('rejects a session that belongs to another user', async () => {
    const res = await postRun({ path: path.join(BROWSE_ROOT, 'project'), prompt: 'x', sessionId: FOREIGN_SESSION });
    expect(res.status).toBe(404);
    expect(runFolderAgent).not.toHaveBeenCalled();
  });

  it('streams progress and records the exchange into the chat session', async () => {
    const folder = path.join(BROWSE_ROOT, 'project');
    const res = await postRun({ path: folder, prompt: 'Add a health check', sessionId: OWNED_SESSION });
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain('"type":"round"');
    expect(body).toContain('"type":"result"');

    expect(recordFolderRunExchange).toHaveBeenCalledWith(
      OWNED_SESSION,
      'admin-1',
      folder,
      'Add a health check',
      expect.objectContaining({ type: 'ai', content: expect.stringContaining('All done.') }),
    );
  });

  it('does not record anything when started without a session', async () => {
    const res = await postRun({ path: path.join(BROWSE_ROOT, 'project'), prompt: 'x' });
    await res.text();
    expect(res.status).toBe(200);
    expect(recordFolderRunExchange).not.toHaveBeenCalled();
  });
});

describe('POST /api/folder/run with a folder-bound session', () => {
  it("refuses to run a session's prompt in a different folder", async () => {
    const res = await postRun({ path: path.join(BROWSE_ROOT, 'project'), prompt: 'x', sessionId: BOUND_ELSEWHERE_SESSION });
    expect(res.status).toBe(409);
    expect(runFolderAgent).not.toHaveBeenCalled();
  });
});

const patchSession = (sessionId: string, body: Record<string, unknown>) =>
  fetch(`${baseUrl}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('PATCH /api/sessions/:sessionId (bind folder)', () => {
  it("binds an allowed folder to the caller's session", async () => {
    const folder = path.join(BROWSE_ROOT, 'project');
    const res = await patchSession(OWNED_SESSION, { folderPath: folder });
    expect(res.status).toBe(200);
    expect(setSessionFolder).toHaveBeenCalledWith(OWNED_SESSION, path.resolve(folder));
    expect((await res.json()).session.folderPath).toBe(path.resolve(folder));
  });

  it('clears the folder with null', async () => {
    const res = await patchSession(OWNED_SESSION, { folderPath: null });
    expect(res.status).toBe(200);
    expect(setSessionFolder).toHaveBeenCalledWith(OWNED_SESSION, null);
  });

  it('rejects non-admins, foreign sessions, folders outside the root, and a missing field', async () => {
    currentRole = 'user';
    expect((await patchSession(OWNED_SESSION, { folderPath: BROWSE_ROOT })).status).toBe(403);
    currentRole = 'admin';
    expect((await patchSession(FOREIGN_SESSION, { folderPath: BROWSE_ROOT })).status).toBe(404);
    expect((await patchSession(OWNED_SESSION, { folderPath: path.dirname(path.resolve(BROWSE_ROOT)) })).status).toBe(400);
    expect((await patchSession(OWNED_SESSION, {})).status).toBe(400);
    expect(setSessionFolder).not.toHaveBeenCalled();
  });
});
