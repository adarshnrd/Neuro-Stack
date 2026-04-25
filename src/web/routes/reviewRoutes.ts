import express from 'express';
import { changeSetService } from '../../services/changeSetService.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('reviewRoutes');

/**
 * GET /api/review/:changeSetId
 * Returns a specific changeset
 */
router.get('/api/review/:changeSetId', (req, res) => {
  try {
    const { changeSetId } = req.params;
    const changeSet = changeSetService.getChangeSet(changeSetId);

    if (!changeSet) {
      res.status(404).json({ type: 'error', content: 'ChangeSet not found.' });
      return;
    }

    res.json(changeSet);
  } catch (error: any) {
    log.error('Error fetching changeset', { source: 'reviewRoutes#getChangeSet', error: error.message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * GET /api/review/session/:sessionId
 * Returns all changesets for a specific session
 */
router.get('/api/review/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const changeSets = changeSetService.listChangeSets(sessionId);
    res.json({ changeSets });
  } catch (error: any) {
    log.error('Error listing session changesets', { source: 'reviewRoutes#listSessionChangeSets', error: error.message });
    res.status(500).json({ type: 'error', content: 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/accept
 * Accepts the changeset and writes proposed changes to disk
 */
router.post('/api/review/:changeSetId/accept', async (req, res) => {
  try {
    const { changeSetId } = req.params;
    await changeSetService.acceptChangeSet(changeSetId);
    res.json({ status: 'success', message: 'Changes applied.' });
  } catch (error: any) {
    log.error('Error accepting changeset', { source: 'reviewRoutes#acceptChangeSet', error: error.message });
    res.status(500).json({ type: 'error', content: error.message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/reject
 * Rejects the changeset
 */
router.post('/api/review/:changeSetId/reject', async (req, res) => {
  try {
    const { changeSetId } = req.params;
    await changeSetService.rejectChangeSet(changeSetId);
    res.json({ status: 'success', message: 'Changes rejected.' });
  } catch (error: any) {
    log.error('Error rejecting changeset', { source: 'reviewRoutes#rejectChangeSet', error: error.message });
    res.status(500).json({ type: 'error', content: error.message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/comment
 * Adds an inline comment to a changeset
 * Body: { fileIndex: number, lineNumber: number, content: string }
 */
router.post('/api/review/:changeSetId/comment', async (req, res) => {
  try {
    const { changeSetId } = req.params;
    const { fileIndex, lineNumber, content } = req.body;

    if (fileIndex == null || lineNumber == null || !content) {
      res.status(400).json({ type: 'error', content: 'fileIndex, lineNumber, and content are required.' });
      return;
    }

    const comment = await changeSetService.addComment(changeSetId, fileIndex, lineNumber, content);
    res.json({ status: 'success', comment });
  } catch (error: any) {
    log.error('Error adding comment', { source: 'reviewRoutes#addComment', error: error.message });
    res.status(500).json({ type: 'error', content: error.message || 'Internal server error.' });
  }
});

/**
 * POST /api/review/:changeSetId/revise
 * Requests a revision for the changeset with overall feedback
 * Body: { feedback: string }
 */
router.post('/api/review/:changeSetId/revise', async (req, res) => {
  try {
    const { changeSetId } = req.params;
    const { feedback } = req.body;

    if (!feedback) {
      res.status(400).json({ type: 'error', content: 'feedback is required.' });
      return;
    }

    await changeSetService.requestRevision(changeSetId, feedback);

    // Call RevisionService in the future
    // await revisionService.processRevision(changeSetId, feedback, req.body.sessionId);

    res.json({ status: 'success', message: 'Revision requested.' });
  } catch (error: any) {
    log.error('Error requesting revision', { source: 'reviewRoutes#requestRevision', error: error.message });
    res.status(500).json({ type: 'error', content: error.message || 'Internal server error.' });
  }
});

export default router;
