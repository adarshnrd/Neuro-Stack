import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ChangeSet, FileChange, ReviewComment } from '../types/reviewTypes.js';
import { ChangeSetStatus, FileChangeStatus } from '../enums/reviewEnum.js';
import { computeLineDiff } from '../utils/diffUtil.js';
import { ensureDirectory, fileExists } from '../utils/fileUtil.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('changeSetService');

export class ChangeSetService {
  private inMemoryStore: Map<string, ChangeSet> = new Map();

  private getChangesetDir(sessionId: string): string {
    return path.join(config.context.basePath, 'changesets', sessionId);
  }

  private async getChangesetFilePath(sessionId: string, changeSetId: string): Promise<string> {
    const dir = this.getChangesetDir(sessionId);
    await ensureDirectory(dir);
    return path.join(dir, `changeset-${changeSetId}.json`);
  }

  /**
   * Load existing changesets from disk into the in-memory store.
   * Can be called on startup to rehydrate state.
   */
  public async loadFromDisk(sessionId?: string): Promise<void> {
    log.info('Loading changesets from disk', { source: 'changeSetService#loadFromDisk', sessionId });
    try {
      if (sessionId) {
        await this.loadSessionChangesetsFromDisk(sessionId);
      } else {
        const changesetsBaseDir = path.join(config.context.basePath, 'changesets');
        if (await fileExists(changesetsBaseDir)) {
          const sessions = await fs.readdir(changesetsBaseDir, { withFileTypes: true });
          for (const session of sessions) {
            if (session.isDirectory()) {
              await this.loadSessionChangesetsFromDisk(session.name);
            }
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to load changesets from disk', { source: 'changeSetService#loadFromDisk', error: message });
    }
  }

  private async loadSessionChangesetsFromDisk(sessionId: string): Promise<void> {
    const dir = this.getChangesetDir(sessionId);
    if (!await fileExists(dir)) return;

    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.json') && file.startsWith('changeset-')) {
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const changeSet: ChangeSet = JSON.parse(content);
          this.inMemoryStore.set(changeSet.changeSetId, changeSet);
        } catch (error: unknown) {
          log.warn(`Failed to parse changeset file ${file}`, { source: 'changeSetService#loadSessionChangesetsFromDisk' });
        }
      }
    }
  }

  private async saveToDisk(changeSet: ChangeSet): Promise<void> {
    try {
      const filePath = await this.getChangesetFilePath(changeSet.sessionId, changeSet.changeSetId);
      await fs.writeFile(filePath, JSON.stringify(changeSet, null, 2), 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to save changeset to disk', { source: 'changeSetService#saveToDisk', error: message, changeSetId: changeSet.changeSetId });
    }
  }

  /**
   * Initialize a new pending changeset and persist it.
   */
  public async createChangeSet(sessionId: string): Promise<ChangeSet> {
    const changeSet: ChangeSet = {
      changeSetId: uuidv4(),
      sessionId,
      status: ChangeSetStatus.PENDING,
      files: [],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.inMemoryStore.set(changeSet.changeSetId, changeSet);
    await this.saveToDisk(changeSet);
    log.info('Created new changeset', { source: 'changeSetService#createChangeSet', changeSetId: changeSet.changeSetId });
    return changeSet;
  }

  /**
   * Adds a file change to the changeset, computes diffs, and persists.
   */
  public async addFileChange(
    changeSetId: string,
    filePath: string,
    originalContent: string,
    proposedContent: string
  ): Promise<void> {
    const changeSet = this.inMemoryStore.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet not found: ${changeSetId}`);
    }

    const diffLines = computeLineDiff(originalContent, proposedContent);
    let status = FileChangeStatus.MODIFIED;
    if (!originalContent && proposedContent) {
      status = FileChangeStatus.ADDED;
    } else if (originalContent && !proposedContent) {
      status = FileChangeStatus.DELETED;
    }

    const fileChange: FileChange = {
      filePath,
      originalContent,
      proposedContent,
      diffLines,
      status,
    };

    // Replace if same file added again during same session
    const existingIndex = changeSet.files.findIndex(f => f.filePath === filePath);
    if (existingIndex >= 0) {
      changeSet.files[existingIndex] = fileChange;
    } else {
      changeSet.files.push(fileChange);
    }

    changeSet.updatedAt = new Date().toISOString();
    await this.saveToDisk(changeSet);
    log.debug('File change added to changeset', { source: 'changeSetService#addFileChange', changeSetId, filePath });
  }

  /**
   * Finalizes the changeset, asserting no more changes will be added to it
   */
  public async finalizeChangeSet(changeSetId: string): Promise<void> {
      // In the future this might change status to Reviewing, but currently keeps it Pending.
      // This is mostly to signal the frontend or flow that it's ready.
      const changeSet = this.inMemoryStore.get(changeSetId);
      if (!changeSet) return;
      
      changeSet.updatedAt = new Date().toISOString();
      await this.saveToDisk(changeSet);
  }

  /**
   * Retrieves a changeset from the store
   */
  public getChangeSet(changeSetId: string): ChangeSet | undefined {
    return this.inMemoryStore.get(changeSetId);
  }

  /**
   * Lists all changesets for a particular session
   */
  public listChangeSets(sessionId: string): ChangeSet[] {
    return Array.from(this.inMemoryStore.values())
      .filter(cs => cs.sessionId === sessionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Accepts the changeset: writes files to workspace and updates status.
   */
  public async acceptChangeSet(changeSetId: string): Promise<void> {
    const changeSet = this.inMemoryStore.get(changeSetId);
    if (!changeSet) throw new Error(`ChangeSet not found: ${changeSetId}`);

    for (const file of changeSet.files) {
      const fullPath = path.join(config.workspace.path, file.filePath);
      if (file.status === FileChangeStatus.DELETED) {
        if (await fileExists(fullPath)) {
          await fs.unlink(fullPath);
        }
      } else {
        await ensureDirectory(path.dirname(fullPath));
        await fs.writeFile(fullPath, file.proposedContent, 'utf-8');
      }
    }

    changeSet.status = ChangeSetStatus.ACCEPTED;
    changeSet.updatedAt = new Date().toISOString();
    await this.saveToDisk(changeSet);
    log.info('ChangeSet accepted', { source: 'changeSetService#acceptChangeSet', changeSetId });
  }

  /**
   * Rejects the changeset.
   */
  public async rejectChangeSet(changeSetId: string): Promise<void> {
    const changeSet = this.inMemoryStore.get(changeSetId);
    if (!changeSet) throw new Error(`ChangeSet not found: ${changeSetId}`);

    changeSet.status = ChangeSetStatus.REJECTED;
    changeSet.updatedAt = new Date().toISOString();
    await this.saveToDisk(changeSet);
    log.info('ChangeSet rejected', { source: 'changeSetService#rejectChangeSet', changeSetId });
  }

  /**
   * Adds an inline comment to a changeset
   */
  public async addComment(
    changeSetId: string,
    fileIndex: number,
    lineNumber: number,
    content: string
  ): Promise<ReviewComment> {
    const changeSet = this.inMemoryStore.get(changeSetId);
    if (!changeSet) throw new Error(`ChangeSet not found: ${changeSetId}`);

    const comment: ReviewComment = {
      id: uuidv4(),
      fileIndex,
      lineNumber,
      content,
      author: 'user',
      timestamp: new Date().toISOString(),
    };

    changeSet.comments.push(comment);
    changeSet.updatedAt = new Date().toISOString();
    await this.saveToDisk(changeSet);
    return comment;
  }

  /**
   * Request a revision of the changeset with overall feedback
   */
  public async requestRevision(changeSetId: string, feedback: string): Promise<void> {
    const changeSet = this.inMemoryStore.get(changeSetId);
    if (!changeSet) throw new Error(`ChangeSet not found: ${changeSetId}`);

    changeSet.status = ChangeSetStatus.REVISION_REQUESTED;
    changeSet.feedback = feedback;
    changeSet.updatedAt = new Date().toISOString();
    await this.saveToDisk(changeSet);
    log.info('ChangeSet revision requested', { source: 'changeSetService#requestRevision', changeSetId });
  }
}

// Export singleton instance
export const changeSetService = new ChangeSetService();
