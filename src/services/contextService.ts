import { ContextLoader, ContextWriter } from '../memory/index.js';
import { CommandName } from '../enums/index.js';

export interface AssembledContext {
  systemRules: string;
  commandTemplate: string;
  sessionContext: string;
  learnedPatterns: string;
}

export class ContextService {
  private loader = new ContextLoader();
  private writer = new ContextWriter();

  async loadForCommand(command: CommandName, sessionId: string): Promise<AssembledContext> {
    const systemRules = await this.loader.loadRules();
    const commandTemplate = command ? await this.loader.loadCommandTemplate(command) : '';
    const sessionContext = sessionId ? await this.loader.loadSessionContext(sessionId) : '';
    const learnedPatterns = await this.loader.loadLearnedPatterns();

    return {
      systemRules,
      commandTemplate,
      sessionContext,
      learnedPatterns
    };
  }

  async appendLearning(pattern: string): Promise<void> {
    await this.writer.appendLearnedPattern(pattern);
  }

  async appendAntiHallucination(rule: string): Promise<void> {
    await this.writer.appendRule(rule, 'anti_hallucination');
  }
}
