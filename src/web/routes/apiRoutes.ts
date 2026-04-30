import express from 'express';
import { handleChatMessage } from '../../services/chatService.js';
import { CommandName } from '../../enums/commandEnum.js';
import { commandRegistry } from '../../commands/registry.js';
import { createChildLogger, withQueryId } from '../../logger/index.js';
import { v4 as uuidv4 } from 'uuid';
import { recordExchange } from '../../services/conversationPersistenceService.js';
import {
  createSession as createDbSession,
  listSessionsByUser,
  findSessionById,
  touchSession,
} from '../../database/sessionRepository.js';
import { getConversationsPaginated, getConversationCount } from '../../database/conversationRepository.js';

const router = express.Router();
const log = createChildLogger('apiRoutes');

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
router.post('/api/chat', async (req, res) => {
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

    let sid = sessionId;
    if (!sid) {
      if (req.userId) {
        const newSession = await createDbSession(req.userId);
        sid = newSession.id;
      } else {
        sid = uuidv4();
      }
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

    // ── NEW: Persist conversation exchange (non-blocking) ──────────────────────
    const userId = req.userId;
    if (userId && sid) {
      // Determine if this is the first message in the session
      const msgCount = await getConversationCount(sid);
      const isFirst = msgCount === 0;

      // Fire-and-forget: don't await this to avoid slowing the response
      recordExchange(sid, userId, message, result, isFirst).catch((err) => {
        traceLog.error('Background persist failed', {
          source: 'apiRoutes#postChat',
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Touch session timestamp
      touchSession(sid).catch(() => { /* silent */ });
    }

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
  const registeredHandlers = commandRegistry.listAll();

  // Build list from all enum values, enriched with handler descriptions
  const commands = Object.values(CommandName).map((name) => {
    const handler = registeredHandlers.find((h) => h.name === name);
    return {
      name,
      trigger: `@${name}`,
      description: handler?.description ?? '',
    };
  });

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
 * Returns a single session by ID.
 */
router.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const session = await findSessionById(req.params.sessionId);
    if (!session) {
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
 * Paginated conversation history for a session.
 * Query params: cursor (uuid, optional), limit (number, default 10)
 */
router.get('/api/sessions/:sessionId/conversations', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string || '10', 10);

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
