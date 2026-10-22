import express, { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runFolderAgent, resumeFolderAgent, getFolderStatus, FolderProgress } from '../../services/folderAgentService.js';
import { config } from '../../config/index.js';
import { PermissionMode } from '../../enums/workspaceEnum.js';
import { ApprovalBroker, ApprovalRequest } from '../../types/workspaceTypes.js';
import { ValidationError } from '../../errors/validationError.js';
import { findSessionById } from '../../database/sessionRepository.js';
import { recordFolderRunExchange } from '../../services/conversationPersistenceService.js';
import { RunStatus } from '../../types/stateStoreTypes.js';
import { ChatResult } from '../../types/chatTypes.js';
import { requireAdmin } from '../middleware/authMiddleware.js';
import { resolveAllowedFolder } from '../../services/workspaceService.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('folderRoutes');

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingApproval {
  userId: string;
  settle: (approved: boolean) => void;
}

// Pending web approvals, keyed by id. The run awaits the resolver; the approve
// endpoint fulfills it. In-memory + single-process (matches the loop model).
const pendingApprovals = new Map<string, PendingApproval>();

// The folder agent writes files and runs shell commands on this host — admins only.
router.use('/api/folder', requireAdmin);

/**
 * GET /api/folder/browse?path=<dir>
 * Lists sub-directories under an allowed base so the UI can navigate to a folder.
 */
router.get('/api/folder/browse', async (req, res) => {
  try {
    const base = config.folderAgent.browseRoot;
    const target = req.query.path ? resolveAllowedFolder(req.query.path) : base;

    const entries = await fs.readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name));

    res.json({ base, current: target, parent: target === base ? null : path.dirname(target), dirs });
  } catch (error: unknown) {
    handleJsonError(res, error, 'browse');
  }
});

/**
 * GET /api/folder/status?path=<dir>
 * Returns the persisted .neurostack run status for a folder.
 */
router.get('/api/folder/status', async (req, res) => {
  try {
    const folder = resolveAllowedFolder(req.query.path);
    res.json({ status: await getFolderStatus(folder) });
  } catch (error: unknown) {
    handleJsonError(res, error, 'status');
  }
});

/**
 * POST /api/folder/run
 * Body: { path, prompt, mode?: 'auto'|'manual', resume?: boolean, sessionId?: string }
 * Streams the folder-agent run as SSE, including interactive approval requests.
 * When started from the chat UI, `sessionId` (owned by the caller) records the
 * prompt and final report into that conversation's history.
 */
router.post('/api/folder/run', async (req, res) => {
  const { path: requestedPath, prompt, mode, resume, sessionId } = req.body ?? {};
  const userId = req.userId;

  let folder: string;
  try {
    folder = resolveAllowedFolder(requestedPath);
    if (!resume && (typeof prompt !== 'string' || !prompt.trim())) {
      throw new ValidationError('prompt', 'is required');
    }
    if (!userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }
    if (sessionId !== undefined && sessionId !== null) {
      const session = typeof sessionId === 'string' ? await findSessionById(sessionId) : null;
      if (!session || session.userId !== userId) {
        res.status(404).json({ type: 'error', content: 'Session not found.' });
        return;
      }
      // A session works on exactly one project — never run its prompt somewhere else
      if (session.folderPath && path.resolve(session.folderPath) !== folder) {
        res.status(409).json({ type: 'error', content: 'This session is bound to a different folder.' });
        return;
      }
    }
  } catch (error: unknown) {
    handleJsonError(res, error, 'run');
    return;
  }

  sseInit(res);
  // The run keeps going if the browser disconnects (state is checkpointed to
  // .neurostack/ and resumable), but we stop writing to the dead socket and
  // auto-deny any approval nobody can answer.
  let clientConnected = true;
  res.on('close', () => {
    clientConnected = false;
  });
  const emit = (event: FolderProgress): void => {
    if (clientConnected) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const permissionMode = mode === 'manual' ? PermissionMode.MANUAL : PermissionMode.AUTO;
  const approvalBroker = createWebBroker(emit, userId, () => clientConnected);
  let outcome: ChatResult;

  try {
    log.info('Folder run requested', { source: 'folderRoutes#run', folder, userId, mode: permissionMode, resume: !!resume });
    const result = resume
      ? await resumeFolderAgent(folder, { permissionMode, approvalBroker, onProgress: emit })
      : await runFolderAgent(folder, prompt, { permissionMode, approvalBroker, onProgress: emit });

    emit({ type: 'result', message: result.content, data: { status: result.status, handoffCount: result.handoffCount } });
    outcome = {
      type: result.status === RunStatus.COMPLETE ? 'ai' : 'system',
      content: `**Folder agent — ${result.status}** · ${result.handoffCount} handoff(s)\n\n${result.content}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Folder run failed', { source: 'folderRoutes#run', folder, error: message });
    emit({ type: 'error', message });
    outcome = { type: 'error', content: `Folder agent failed: ${message}` };
  } finally {
    res.end();
  }

  if (typeof sessionId === 'string') {
    await recordFolderRunExchange(sessionId, userId, folder, resume ? null : prompt, outcome);
  }
});

/**
 * POST /api/folder/approve
 * Body: { approvalId, approved }
 * Resolves a pending high-risk-command approval so the paused run continues.
 * Only the user who started the run may answer its approvals.
 */
router.post('/api/folder/approve', (req, res) => {
  const { approvalId, approved } = req.body ?? {};
  const pending = typeof approvalId === 'string' ? pendingApprovals.get(approvalId) : undefined;
  if (!pending || pending.userId !== req.userId) {
    res.status(404).json({ type: 'error', content: 'No pending approval with that id.' });
    return;
  }
  pending.settle(approved === true);
  res.json({ ok: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createWebBroker(
  emit: (event: FolderProgress) => void,
  userId: string,
  isClientConnected: () => boolean,
): ApprovalBroker {
  return (request: ApprovalRequest) =>
    new Promise<boolean>((resolve) => {
      if (!isClientConnected()) {
        resolve(false);
        return;
      }

      const approvalId = uuidv4();
      let settled = false;
      // Auto-deny if the user never responds, so a run can't hang forever.
      const timeout = setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS);
      const settle = (isApproved: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        pendingApprovals.delete(approvalId);
        resolve(isApproved);
      };

      pendingApprovals.set(approvalId, { userId, settle });
      emit({
        type: 'approval_request',
        message: `Approval needed (${request.risk}): ${request.reason}`,
        data: { approvalId, command: request.command, risk: request.risk },
      });
    });
}

function sseInit(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function handleJsonError(res: Response, error: unknown, routeName: string): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ValidationError) {
    res.status(error.statusCode).json({ type: 'error', content: message });
    return;
  }
  log.error('Folder route error', { source: `folderRoutes#${routeName}`, error: message });
  res.status(500).json({ type: 'error', content: message });
}

export default router;
