import { BaseMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('promptInjector');

export class PromptInjector {
  /**
   * Assembles the full prompt from various markdown context strings.
   */
  public buildPrompt(
    systemRules: string,
    commandTemplate: string,
    sessionContext: string,
    learnedPatterns: string,
    userMessage: string
  ): BaseMessage[] {
    log.debug('Assembling full prompt', { source: 'promptInjector#buildPrompt' });
    const messages: BaseMessage[] = [];

    let systemContent = '';
    
    if (systemRules) {
      log.debug('Injecting system rules', { source: 'promptInjector#buildPrompt', length: systemRules.length });
      systemContent += `${systemRules}\n\n`;
    }

    if (commandTemplate) {
      log.debug('Injecting command template', { source: 'promptInjector#buildPrompt', length: commandTemplate.length });
      systemContent += `## Current Command Context\n${commandTemplate}\n\n`;
    }

    if (sessionContext) {
      log.debug('Injecting session context', { source: 'promptInjector#buildPrompt', length: sessionContext.length });
      systemContent += `## Active Session Context\n${sessionContext}\n\n`;
    }

    if (learnedPatterns) {
      log.debug('Injecting learned patterns', { source: 'promptInjector#buildPrompt', length: learnedPatterns.length });
      systemContent += `## Learned Patterns & Anti-Hallucination\n${learnedPatterns}\n\n`;
    }

    if (systemContent.trim()) {
      messages.push(new SystemMessage(systemContent.trim()));
    }

    if (userMessage.trim()) {
      messages.push(new HumanMessage(userMessage.trim()));
    }

    log.debug('Prompt assembly complete', { source: 'promptInjector#buildPrompt', messageCount: messages.length, totalSystemLength: systemContent.length });
    return messages;
  }
}
