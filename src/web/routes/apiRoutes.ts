import express from 'express';
import { handleChatMessage } from '../../services/chatService.js';
import { commandRegistry } from '../../commands/registry.js';
import { createChildLogger, withQueryId } from '../../logger/index.js';
import { v4 as uuidv4 } from 'uuid';
import { recordExchange } from '../../services/conversationPersistenceService.js';
import {
  createSession as createDbSession,
  listSessionsByUser,
  findSessionById,
  touchSession,
  setSessionTitleIfEmpty,
} from '../../database/sessionRepository.js';
import { getConversationsPaginated } from '../../database/conversationRepository.js';
import { truncateText } from '../../utils/stringUtil.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const log = createChildLogger('apiRoutes');

// Each chat message costs an LLM call — cap per-client throughput
const chatLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, name: 'chat' });

/**
 * Health check
 */
router.get('/api/health', (req, res) => {
  log.debug('Health check requested', { source: 'apiRoutes#getHealth' });
  res.json({ status: 'ok' });
});

/**
 * POST /api/chat
 * Accepts { message: string, sessionId?: string }
 * Returns  { type, content, sessionId }
 *
 * The core handleChatMessage() call is UNTOUCHED.
 * Conversation persistence is added as a non-blocking side-effect after the response.
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
  const queryId = uuidv4();
  const traceLog = withQueryId(log, queryId);
  const startTime = Date.now();

  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string') {
      traceLog.warn('Validation failed: Message is required', { source: 'apiRoutes#postChat' });
      res.status(400).json({ type: 'error', content: 'Message is required.' });
      return;
    }

    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }

    let sid = sessionId;
    if (sid) {
      // Never trust a client-supplied session ID — it must belong to the caller
      const session = await findSessionById(sid);
      if (!session || session.userId !== userId) {
        traceLog.warn('Rejected chat for unknown or foreign session', { source: 'apiRoutes#postChat', sessionId: sid });
        res.status(404).json({ type: 'error', content: 'Session not found.' });
        return;
      }
    } else {
      const newSession = await createDbSession(userId);
      sid = newSession.id;
    }

    traceLog.info('Chat request received', { 
      source: 'apiRoutes#postChat',
      sessionId: sid, 
      messageLength: message.length,
      contentType: req.headers['content-type']
    });

    // ── Existing flow — UNTOUCHED ──────────────────────────────────────────────
    const result = await handleChatMessage(message, sid, queryId);

    const durationMs = Date.now() - startTime;
    traceLog.info('Chat response sent', { 
      source: 'apiRoutes#postChat',
      sessionId: sid,
      responseType: result.type,
      durationMs
    });

    // ── Persist conversation exchange ─────────────────────────────────────────
    // First message names the session. The conditional update only fires while
    // the title is still empty, so concurrent messages cannot clobber it.
    // Awaited so the client sees the title when it refreshes the sidebar.
    await setSessionTitleIfEmpty(sid, truncateText(message, 50));

    // Fire-and-forget: persist conversation rows without blocking the response.
    recordExchange(sid, userId, message, result).catch((err) => {
      traceLog.error('Background persist failed', {
        source: 'apiRoutes#postChat',
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Touch session timestamp
    touchSession(sid).catch(() => { /* silent */ });

    res.json({ ...result, sessionId: sid });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    traceLog.error('Chat endpoint error', { 
      source: 'apiRoutes#postChat',
      error: errMsg,
      stack: errStack,
    });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * GET /api/commands
 * Returns the list of available @ commands with descriptions
 */
router.get('/api/commands', (req, res) => {
  log.debug('Commands list requested', { source: 'apiRoutes#getCommands' });

  // Only advertise commands that actually have a registered handler
  const commands = commandRegistry.listAll().map((handler) => ({
    name: handler.name,
    trigger: `@${handler.name}`,
    description: handler.description,
  }));

  res.json({ commands });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SESSION & CONVERSATION HISTORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/sessions
 * Returns all sessions for the authenticated user, newest first.
 */
router.get('/api/sessions', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }

    const sessions = await listSessionsByUser(userId);
    res.json({ sessions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to list sessions', { source: 'apiRoutes#getSessions', error: message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * POST /api/sessions
 * Creates a new session for the authenticated user.
 * Session is persisted immediately (title set later on first message).
 */
router.post('/api/sessions', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
      return;
    }

    const session = await createDbSession(userId);
    res.status(201).json({ session });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to create session', { source: 'apiRoutes#createSession', error: message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * GET /api/sessions/:sessionId
 * Returns a single session by ID. Only the owner may read it.
 */
router.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const session = await findSessionById(req.params.sessionId);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ type: 'error', content: 'Session not found.' });
      return;
    }
    res.json({ session });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to get session', { source: 'apiRoutes#getSession', error: message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * GET /api/sessions/:sessionId/conversations
 * Paginated conversation history for a session. Only the owner may read it.
 * Query params: cursor (uuid, optional), limit (number, default 10, max 100)
 */
router.get('/api/sessions/:sessionId/conversations', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string || '10', 10) || 10, 1), 100);

    const session = await findSessionById(sessionId);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ type: 'error', content: 'Session not found.' });
      return;
    }

    const result = await getConversationsPaginated(sessionId, limit, cursor);
    res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to fetch conversations', {
      source: 'apiRoutes#getConversations',
      error: message,
    });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

export default router;
