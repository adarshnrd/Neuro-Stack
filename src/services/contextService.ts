import { ContextLoader } from '../memory/index.js';
import { CommandName } from '../enums/index.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('contextService');

export interface AssembledContext {
  systemRules: string;
  commandTemplate: string;
  learnedPatterns: string;
}

export class ContextService {
  private readonly loader = new ContextLoader();

  public async loadForCommand(command: CommandName, sessionId: string): Promise<AssembledContext> {
    log.info('Loading context for command', { source: 'contextService#loadForCommand', command, sessionId });
    
    const systemRules = await this.loader.loadRules();
    const commandTemplate = command ? await this.loader.loadCommandTemplate(command) : '';
    const learnedPatterns = await this.loader.loadLearnedPatterns();

    log.debug('Context components loaded', { 
      source: 'contextService#loadForCommand',
      rulesLength: systemRules.length,
      commandTemplateLength: commandTemplate.length,
      learnedLength: learnedPatterns.length
    });

    return {
      systemRules,
      commandTemplate,
      learnedPatterns
    };
  }
}
