import path from 'path';
import { fileExists, readJson, writeJson, ensureDirectory } from '../utils/fileUtil.js';
import { Session } from '../types/sessionTypes.js';
import { SessionStatus } from '../enums/sessionEnum.js';
import { getFutureDateByHours } from '../utils/dateUtil.js';
import { config } from '../config/index.js';
import { generateId } from '../utils/stringUtil.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('sessionManager');

export class SessionManager {
  private getSessionPath(sessionId: string): string {
    return path.join(config.context.basePath, 'sessions', `session_${sessionId}.json`);
  }

  public async createSession(): Promise<Session> {
    const sessionId = generateId();
    const now = new Date();
    
    log.info('Creating new session instance', { source: 'sessionManager#createSession', sessionId });
    
    const session: Session = {
      id: sessionId,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: getFutureDateByHours(config.session.activeWindowHours),
      status: SessionStatus.ACTIVE,
      intent: '',
      decisions: [],
      actions: [],
      currentState: '',
      learned: [],
    };

    const sessionPath = this.getSessionPath(sessionId);
    await writeJson(sessionPath, session);
    
    log.debug('Session JSON written to disk', { source: 'sessionManager#createSession', sessionPath });
    
    // Also create a readable MD representation
    await this.updateSessionMd(session);
    return session;
  }

  public async getSession(sessionId: string): Promise<Session | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const exists = await fileExists(sessionPath);
    
    log.debug('Retrieving session', { source: 'sessionManager#getSession', sessionId, exists });
    
    if (!exists) return null;
    
    const sessionStr = await readJson<any>(sessionPath);
    if(!sessionStr) return null;

    // Serialize string dates back to Date objects
    return {
      ...sessionStr,
      createdAt: new Date(sessionStr.createdAt),
      lastActiveAt: new Date(sessionStr.lastActiveAt),
      expiresAt: new Date(sessionStr.expiresAt),
    };
  }

  public async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      log.warn('Attempted to update non-existent session', { source: 'sessionManager#updateSession', sessionId });
      return null;
    }

    log.debug('Updating session', { source: 'sessionManager#updateSession', sessionId, updatedKeys: Object.keys(updates) });

    const updatedSession = { ...session, ...updates, lastActiveAt: new Date() };
    await writeJson(this.getSessionPath(sessionId), updatedSession);
    await this.updateSessionMd(updatedSession);

    return updatedSession;
  }

  private async updateSessionMd(session: Session): Promise<void> {
    const content = `# Session: ${session.id}
Created: ${session.createdAt.toISOString()}
Last Updated: ${session.lastActiveAt.toISOString()}
Expires At: ${session.expiresAt.toISOString()}
Status: ${session.status}

## User Intent
${session.intent}

## Key Decisions
${session.decisions.map(d => `- ${d}`).join('\n')}

## Actions Taken
${session.actions.map(a => `- [${a.completed ? 'x' : ' '}] ${a.description}`).join('\n')}

## Current State
${session.currentState}

## Learned
${session.learned.map(l => `- ${l}`).join('\n')}
`;
    const mdPath = path.join(config.context.basePath, 'sessions', `session_${session.id}.md`);
    await ensureDirectory(path.join(config.context.basePath, 'sessions'));
    import('fs/promises').then(fs => {
      log.debug('Session MD snapshot updated', { source: 'sessionManager#updateSessionMd', sessionId: session.id });
      return fs.writeFile(mdPath, content, 'utf-8');
    });
  }

  public async archiveSession(sessionId: string): Promise<void> {
    log.info('Archiving session', { source: 'sessionManager#archiveSession', sessionId });
    await this.updateSession(sessionId, { status: SessionStatus.ARCHIVED });
    const fs = await import('fs/promises');
    
    const sessionPath = this.getSessionPath(sessionId);
    const mdPath = path.join(config.context.basePath, 'sessions', `session_${sessionId}.md`);
    
    const archivePath = path.join(config.context.basePath, 'archive');
    await ensureDirectory(archivePath);
    
    if (await fileExists(sessionPath)) {
      log.debug('Moving session JSON to archive', { source: 'sessionManager#archiveSession', sessionId });
      await fs.rename(sessionPath, path.join(archivePath, `session_${sessionId}.json`));
    }
    if (await fileExists(mdPath)) {
      log.debug('Moving session MD to archive', { source: 'sessionManager#archiveSession', sessionId });
      await fs.rename(mdPath, path.join(archivePath, `session_${sessionId}.md`));
    }
  }

  public async purgeSession(sessionId: string): Promise<void> {
    log.info('Purging session fully', { source: 'sessionManager#purgeSession', sessionId });
    const fs = await import('fs/promises');
    
    const paths = [
      this.getSessionPath(sessionId),
      path.join(config.context.basePath, 'sessions', `session_${sessionId}.md`),
      path.join(config.context.basePath, 'archive', `session_${sessionId}.json`),
      path.join(config.context.basePath, 'archive', `session_${sessionId}.md`)
    ];

    let deletedCount = 0;
    for (const p of paths) {
      if (await fileExists(p)) {
        await fs.unlink(p);
        deletedCount++;
      }
    }
    log.debug('Purged session files', { source: 'sessionManager#purgeSession', sessionId, deletedCount });
  }
}
