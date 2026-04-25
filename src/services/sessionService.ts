import { SessionManager, ArchiveManager } from '../memory/index.js';
import { Session } from '../types/sessionTypes.js';
import { SessionStatus } from '../enums/sessionEnum.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('sessionService');

export class SessionService {
  private readonly sessionManager = new SessionManager();
  private readonly archiveManager = new ArchiveManager();

  public async createSession(): Promise<Session> {
    log.info('Creating new session instance', { source: 'sessionService#createSession' });
    return this.sessionManager.createSession();
  }

  public async getActiveSession(sessionId: string): Promise<Session | null> {
    log.debug('Getting active session', { source: 'sessionService#getActiveSession', sessionId });
    return this.sessionManager.getSession(sessionId);
  }

  public async expireSession(sessionId: string): Promise<void> {
    log.info('Expiring session', { source: 'sessionService#expireSession', sessionId });
    await this.sessionManager.updateSession(sessionId, { status: SessionStatus.EXPIRED });
  }

  public async archiveSession(sessionId: string): Promise<void> {
    log.info('Archiving session', { source: 'sessionService#archiveSession', sessionId });
    await this.sessionManager.archiveSession(sessionId);
  }

  public async runAutoCleanup(): Promise<void> {
    log.info('Running auto cleanup for sessions', { source: 'sessionService#runAutoCleanup' });
    await this.archiveManager.runCleanup();
  }
  
  public async addLearningToSession(sessionId: string, learning: string): Promise<void> {
    log.debug('Adding learning to session', { source: 'sessionService#addLearningToSession', sessionId, learningLength: learning.length });
    const session = await this.sessionManager.getSession(sessionId);
    if(session) {
      log.info('Updating session with new learning', { source: 'sessionService#addLearningToSession', sessionId });
      const learned = [...session.learned, learning];
      await this.sessionManager.updateSession(sessionId, { learned });
    } else {
      log.warn('Attempted to add learning to non-existent session', { source: 'sessionService#addLearningToSession', sessionId });
    }
  }
}
