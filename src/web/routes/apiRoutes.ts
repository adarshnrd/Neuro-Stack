import express from 'express';
import { handleChatMessage } from '../../services/chatService.js';
import { CommandName } from '../../enums/commandEnum.js';
import { commandRegistry } from '../../commands/registry.js';
import { createChildLogger, withQueryId } from '../../logger/index.js';
import { v4 as uuidv4 } from 'uuid';

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
 * Returns  { type, content }
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

    const sid = sessionId || uuidv4();
    traceLog.info('Chat request received', { 
      source: 'apiRoutes#postChat',
      sessionId: sid, 
      messageLength: message.length,
      contentType: req.headers['content-type']
    });

    const result = await handleChatMessage(message, sid, queryId);

    const durationMs = Date.now() - startTime;
    traceLog.info('Chat response sent', { 
      source: 'apiRoutes#postChat',
      sessionId: sid,
      responseType: result.type,
      durationMs
    });

    res.json({ ...result, sessionId: sid });
  } catch (error: any) {
    traceLog.error('Chat endpoint error', { 
      source: 'apiRoutes#postChat',
      error: error.message,
      stack: error.stack
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

export default router;
