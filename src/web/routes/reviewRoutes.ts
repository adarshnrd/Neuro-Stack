import express from 'express';
import { changeSetService } from '../../services/changeSetService.js';
import { findSessionById } from '../../database/sessionRepository.js';
import { ChangeSet } from '../../types/reviewTypes.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('reviewRoutes');

/**
 * Resolves a changeset only if it belongs to a session owned by the caller.
 * Returns null (treated as not found) for unknown changesets, foreign
 * changesets, or changesets whose session no longer exists.
 */
async function findOwnedChangeSet(changeSetId: string, userId: string | undefined): Promise<ChangeSet | null> {
  if (!userId) return null;

  const changeSet = changeSetService.getChangeSet(changeSetId);
  if (!changeSet) return null;

  const session = await findSessionById(changeSet.sessionId);
  if (!session || session.userId !== userId) return null;

  return changeSet;
}

/**
 * GET /api/review/:changeSetId
 * Returns a specific changeset (owner only)
 */
router.get('/api/review/:changeSetId', async (req, res) => {
  try {
    const changeSet = await findOwnedChangeSet(req.params.changeSetId, req.userId);

    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    res.json(changeSet);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error fetching changeset', { source: 'reviewRoutes#getChangeSet', error: message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * GET /api/review/session/:sessionId
 * Returns all changesets for a specific session (owner only)
 */
router.get('/api/review/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await findSessionById(sessionId);
    if (!session || session.userId !== req.userId) {
      res.status(404).json({ type: 'error', content: 'Session not found.' });
      return;
    }

    const changeSets = changeSetService.listChangeSets(sessionId);
    res.json({ changeSets });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error listing session changesets', { source: 'reviewRoutes#listSessionChangeSets', error: message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/accept
 * Accepts the changeset and writes proposed changes to disk (owner only)
 */
router.post('/api/review/:changeSetId/accept', async (req, res) => {
  try {
    const changeSet = await findOwnedChangeSet(req.params.changeSetId, req.userId);
    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    await changeSetService.acceptChangeSet(changeSet.changeSetId);
    res.json({ status: 'success', message: 'Changes applied.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error accepting changeset', { source: 'reviewRoutes#acceptChangeSet', error: message });
    res.status(500).json({ type: 'error', content: message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/reject
 * Rejects the changeset (owner only)
 */
router.post('/api/review/:changeSetId/reject', async (req, res) => {
  try {
    const changeSet = await findOwnedChangeSet(req.params.changeSetId, req.userId);
    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    await changeSetService.rejectChangeSet(changeSet.changeSetId);
    res.json({ status: 'success', message: 'Changes rejected.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error rejecting changeset', { source: 'reviewRoutes#rejectChangeSet', error: message });
    res.status(500).json({ type: 'error', content: message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/comment
 * Adds an inline comment to a changeset (owner only)
 * Body: { fileIndex: number, lineNumber: number, content: string }
 */
router.post('/api/review/:changeSetId/comment', async (req, res) => {
  try {
    const { fileIndex, lineNumber, content } = req.body;

    if (fileIndex == null || lineNumber == null || !content) {
      res.status(400).json({ type: 'error', content: 'fileIndex, lineNumber, and content are required.' });
      return;
    }

    const changeSet = await findOwnedChangeSet(req.params.changeSetId, req.userId);
    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    const comment = await changeSetService.addComment(changeSet.changeSetId, fileIndex, lineNumber, content);
    res.json({ status: 'success', comment });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error adding comment', { source: 'reviewRoutes#addComment', error: message });
    res.status(500).json({ type: 'error', content: message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/revise
 * Requests a revision for the changeset with overall feedback (owner only)
 * Body: { feedback: string }
 */
router.post('/api/review/:changeSetId/revise', async (req, res) => {
  try {
    const { feedback } = req.body;

    if (!feedback) {
      res.status(400).json({ type: 'error', content: 'feedback is required.' });
      return;
    }

    const changeSet = await findOwnedChangeSet(req.params.changeSetId, req.userId);
    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    await changeSetService.requestRevision(changeSet.changeSetId, feedback);

    // Call RevisionService in the future
    // await revisionService.processRevision(changeSetId, feedback, req.body.sessionId);

    res.json({ status: 'success', message: 'Revision requested.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Error requesting revision', { source: 'reviewRoutes#requestRevision', error: message });
    res.status(500).json({ type: 'error', content: message || 'Internal server error.' });
  }
});

export default router;
