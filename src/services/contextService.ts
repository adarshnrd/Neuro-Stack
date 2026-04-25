import { ContextLoader, ContextWriter } from '../memory/index.js';
import { CommandName } from '../enums/index.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('contextService');

export interface AssembledContext {
  systemRules: string;
  commandTemplate: string;
  sessionContext: string;
  learnedPatterns: string;
}

export class ContextService {
  private readonly loader = new ContextLoader();
  private readonly writer = new ContextWriter();

  public async loadForCommand(command: CommandName, sessionId: string): Promise<AssembledContext> {
    log.info('Loading context for command', { source: 'contextService#loadForCommand', command, sessionId });
    
    const systemRules = await this.loader.loadRules();
    const commandTemplate = command ? await this.loader.loadCommandTemplate(command) : '';
    const sessionContext = sessionId ? await this.loader.loadSessionContext(sessionId) : '';
    const learnedPatterns = await this.loader.loadLearnedPatterns();

    log.debug('Context components loaded', { 
      source: 'contextService#loadForCommand',
      rulesLength: systemRules.length,
      commandTemplateLength: commandTemplate.length,
      sessionContextLength: sessionContext.length,
      learnedLength: learnedPatterns.length
    });

    return {
      systemRules,
      commandTemplate,
      sessionContext,
      learnedPatterns
    };
  }

  public async appendLearning(pattern: string): Promise<void> {
    log.info('Appending learned pattern', { source: 'contextService#appendLearning', patternLength: pattern.length });
    await this.writer.appendLearnedPattern(pattern);
  }

  public async appendAntiHallucination(rule: string): Promise<void> {
    log.info('Appending anti-hallucination rule', { source: 'contextService#appendAntiHallucination', ruleLength: rule.length });
    await this.writer.appendRule(rule, 'anti_hallucination');
  }
}
