import express, { Response } from 'express';
import { startRun, resumeRun } from '../../services/agentLoopService.js';
import { taskSpecFromRequirement, loadTaskSpec } from '../../services/taskSpecService.js';
import { findSessionById } from '../../database/sessionRepository.js';
import { LoopProgressEvent, LoopRunResult } from '../../types/agentTaskTypes.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('loopRoutes');

function sseInit(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sseSend(res: Response, event: LoopProgressEvent | { type: 'result'; result: LoopRunResult }): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function pump(
  res: Response,
  generator: AsyncGenerator<LoopProgressEvent, LoopRunResult>,
): Promise<void> {
  let result: LoopRunResult | undefined;
  while (true) {
    const next = await generator.next();
    if (next.done) {
      result = next.value;
      break;
    }
    sseSend(res, next.value);
  }
  if (result) sseSend(res, { type: 'result', result });
  res.end();
}

/**
 * POST /api/loop
 * Body: { sessionId, requirement?, slug?, autoApprove?, maxIterations? }
 * Streams loop progress as Server-Sent Events.
 */
router.post('/api/loop', async (req, res) => {
  try {
    const { sessionId, requirement, slug, autoApprove, maxIterations } = req.body;
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }
    const session = await findSessionById(sessionId);
    if (!session || session.userId !== userId) {
      res.status(404).json({ type: 'error', content: 'Session not found.' });
      return;
    }

    const spec = slug ? await loadTaskSpec(slug) : requirement ? taskSpecFromRequirement(requirement) : null;
    if (!spec) {
      res.status(400).json({ type: 'error', content: 'Provide a requirement or a valid task slug.' });
      return;
    }

    log.info('Loop run requested', { source: 'loopRoutes#postLoop', sessionId, slug: spec.slug });
    sseInit(res);
    await pump(
      res,
      startRun(spec, {
        sessionId,
        autoApprove: autoApprove !== false,
        maxIterations: typeof maxIterations === 'number' ? maxIterations : undefined,
      }),
    );
  } catch (error: unknown) {
    handleError(res, error, 'postLoop');
  }
});

/**
 * POST /api/loop/:threadId/resume
 * Body: { approved: boolean }
 * Resumes a run paused at the approval gate; streams the remainder as SSE.
 */
router.post('/api/loop/:threadId/resume', async (req, res) => {
  try {
    if (!req.userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }
    const { threadId } = req.params;
    const approved = req.body?.approved === true;

    sseInit(res);
    await pump(res, resumeRun(threadId, approved));
  } catch (error: unknown) {
    handleError(res, error, 'resumeLoop');
  }
});

function handleError(res: Response, error: unknown, source: string): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Loop route error', { source: `loopRoutes#${source}`, error: message });
  if (res.headersSent) {
    sseSend(res, { type: 'error', message });
    res.end();
  } else {
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
}

export default router;
