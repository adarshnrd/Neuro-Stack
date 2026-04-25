import { CommandHandler, CommandArgs, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { SessionService } from '../../services/sessionService.js';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('newSessionHandler');

export class NewSessionHandler implements CommandHandler {
  name = CommandName.NEW_SESSION;
  description = 'Archive the current session and start a fresh context.';

  constructor(private sessionService: SessionService = new SessionService()) {}

  async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    log.debug('Executing NEW_SESSION handler', { source: 'newSessionHandler#execute', currentSessionId: sessionId });
    if (sessionId) {
      log.info('Archiving active session', { source: 'newSessionHandler#execute', sessionId });
      await this.sessionService.archiveSession(sessionId);
    }
    
    const newSession = await this.sessionService.createSession();
    log.info('New session created', { source: 'newSessionHandler#execute', newSessionId: newSession.id });
    
    return {
      success: true,
      message: `New session started. Session ${sessionId} has been archived.`,
      data: {
        newSessionId: newSession.id
      }
    };
  }
}
