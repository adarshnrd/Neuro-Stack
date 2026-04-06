import { SessionManager, ArchiveManager } from '../memory/index.js';
import { Session } from '../types/sessionTypes.js';
import { SessionStatus } from '../enums/sessionEnum.js';
import { logger } from '../logger/index.js';

export class SessionService {
  private sessionManager = new SessionManager();
  private archiveManager = new ArchiveManager();

  async createSession(): Promise<Session> {
    logger.info('Creating new session');
    return this.sessionManager.createSession();
  }

  async getActiveSession(sessionId: string): Promise<Session | null> {
    return this.sessionManager.getSession(sessionId);
  }

  async expireSession(sessionId: string): Promise<void> {
    logger.info('Expiring session', { sessionId });
    await this.sessionManager.updateSession(sessionId, { status: SessionStatus.EXPIRED });
  }

  async archiveSession(sessionId: string): Promise<void> {
    logger.info('Archiving session', { sessionId });
    await this.sessionManager.archiveSession(sessionId);
  }

  async runAutoCleanup(): Promise<void> {
    logger.info('Running auto cleanup for sessions..');
    await this.archiveManager.runCleanup();
  }
  
  async addLearningToSession(sessionId: string, learning: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if(session) {
      const learned = [...session.learned, learning];
      await this.sessionManager.updateSession(sessionId, { learned });
    }
  }
}
