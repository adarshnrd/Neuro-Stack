import { BaseMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';

export class PromptInjector {
  /**
   * Assembles the full prompt from various markdown context strings.
   */
  buildPrompt(
    systemRules: string,
    commandTemplate: string,
    sessionContext: string,
    learnedPatterns: string,
    userMessage: string
  ): BaseMessage[] {
    const messages: BaseMessage[] = [];

    let systemContent = '';
    
    if (systemRules) {
      systemContent += `${systemRules}\n\n`;
    }

    if (commandTemplate) {
      systemContent += `## Current Command Context\n${commandTemplate}\n\n`;
    }

    if (sessionContext) {
      systemContent += `## Active Session Context\n${sessionContext}\n\n`;
    }

    if (learnedPatterns) {
      systemContent += `## Learned Patterns & Anti-Hallucination\n${learnedPatterns}\n\n`;
    }

    if (systemContent.trim()) {
      messages.push(new SystemMessage(systemContent.trim()));
    }

    if (userMessage.trim()) {
      messages.push(new HumanMessage(userMessage.trim()));
    }

    return messages;
  }
}
