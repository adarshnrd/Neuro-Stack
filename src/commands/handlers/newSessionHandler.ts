import { CommandHandler, CommandArgs, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { SessionService } from '../../services/sessionService.js';

export class NewSessionHandler implements CommandHandler {
  name = CommandName.NEW_SESSION;
  description = 'Archive the current session and start a fresh context.';

  constructor(private sessionService: SessionService = new SessionService()) {}

  async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    if (sessionId) {
      await this.sessionService.archiveSession(sessionId);
    }
    
    const newSession = await this.sessionService.createSession();
    
    return {
      success: true,
      message: `New session started. Session ${sessionId} has been archived.`,
      data: {
        newSessionId: newSession.id
      }
    };
  }
}
