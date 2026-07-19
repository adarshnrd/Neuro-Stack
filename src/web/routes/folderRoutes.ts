import express, { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runFolderAgent, resumeFolderAgent, getFolderStatus, FolderProgress } from '../../services/folderAgentService.js';
import { config } from '../../config/index.js';
import { resolveInsideRoot } from '../../utils/fileUtil.js';
import { PermissionMode } from '../../enums/workspaceEnum.js';
import { ApprovalBroker, ApprovalRequest } from '../../types/workspaceTypes.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('folderRoutes');

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

// Pending web approvals, keyed by id. The run awaits the resolver; the approve
// endpoint fulfills it. In-memory + single-process (matches the loop model).
const pendingApprovals = new Map<string, (approved: boolean) => void>();

/**
 * GET /api/folder/browse?path=<dir>
 * Lists sub-directories under an allowed base so the UI can navigate to a folder.
 */
router.get('/api/folder/browse', async (req, res) => {
  try {
    const base = config.folderAgent.browseRoot;
    const target = req.query.path ? resolveInsideRoot(base, path.relative(base, String(req.query.path))) : base;

    const entries = await fs.readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

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
    const dir = String(req.query.path || '');
    if (!dir) {
      res.status(400).json({ type: 'error', content: 'path is required.' });
      return;
    }
    res.json({ status: await getFolderStatus(dir) });
  } catch (error: unknown) {
    handleJsonError(res, error, 'status');
  }
});

/**
 * POST /api/folder/run
 * Body: { path, prompt, mode?: 'auto'|'manual', resume?: boolean }
 * Streams the folder-agent run as SSE, including interactive approval requests.
 */
router.post('/api/folder/run', async (req, res) => {
  const { path: folder, prompt, mode, resume } = req.body ?? {};
  if (!folder || (!resume && !prompt)) {
    res.status(400).json({ type: 'error', content: 'path and prompt are required.' });
    return;
  }

  sseInit(res);
  const emit = (event: FolderProgress) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const permissionMode = mode === 'manual' ? PermissionMode.MANUAL : PermissionMode.AUTO;
  const approvalBroker = createWebBroker(emit);

  try {
    log.info('Folder run requested', { source: 'folderRoutes#run', folder, mode: permissionMode, resume: !!resume });
    const result = resume
      ? await resumeFolderAgent(folder, { permissionMode, approvalBroker, onProgress: emit })
      : await runFolderAgent(folder, prompt, { permissionMode, approvalBroker, onProgress: emit });

    emit({ type: 'result', message: result.content, data: { status: result.status, handoffCount: result.handoffCount } });
  } catch (error: unknown) {
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
});

/**
 * POST /api/folder/approve
 * Body: { approvalId, approved }
 * Resolves a pending high-risk-command approval so the paused run continues.
 */
router.post('/api/folder/approve', (req, res) => {
  const { approvalId, approved } = req.body ?? {};
  const resolver = pendingApprovals.get(approvalId);
  if (!resolver) {
    res.status(404).json({ type: 'error', content: 'No pending approval with that id.' });
    return;
  }
  pendingApprovals.delete(approvalId);
  resolver(approved === true);
  res.json({ ok: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createWebBroker(emit: (e: FolderProgress) => void): ApprovalBroker {
  return (request: ApprovalRequest) =>
    new Promise<boolean>((resolve) => {
      const approvalId = uuidv4();
      let settled = false;
      const settle = (approved: boolean) => {
        if (settled) return;
        settled = true;
        pendingApprovals.delete(approvalId);
        resolve(approved);
      };

      pendingApprovals.set(approvalId, settle);
      emit({
        type: 'approval_request',
        message: `Approval needed (${request.risk}): ${request.reason}`,
        data: { approvalId, command: request.command, risk: request.risk },
      });

      // Auto-deny if the user never responds, so a run can't hang forever.
      setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS);
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

function handleJsonError(res: Response, error: unknown, source: string): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Folder route error', { source: `folderRoutes#${source}`, error: message });
  res.status(500).json({ type: 'error', content: message });
}

export default router;
