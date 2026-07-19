import fs from 'fs/promises';
import path from 'path';
import { fileExists } from '../utils/fileUtil.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('contextLoader');

export class ContextLoader {
  private async readFileSafe(filePath: string): Promise<string> {
    const exists = await fileExists(filePath);
    log.debug('Reading file safe', { source: 'contextLoader#readFileSafe', filePath, exists });
    if (exists) {
      return fs.readFile(filePath, 'utf-8');
    }
    return '';
  }

  public async loadRules(): Promise<string> {
    log.debug('Loading rules', { source: 'contextLoader#loadRules' });
    const systemRules = await this.readFileSafe(path.join(config.context.basePath, 'rules', 'system_rules.md'));
    const antiHallucination = await this.readFileSafe(path.join(config.context.basePath, 'rules', 'anti_hallucination.md'));
    const guidelines = await this.readFileSafe(path.join(config.context.basePath, 'agents', 'code_generation_guidelines.md'));
    
    const assembled = [systemRules, antiHallucination, guidelines].filter(Boolean).join('\n\n');
    log.debug('Rules assembled', { source: 'contextLoader#loadRules', length: assembled.length });
    return assembled;
  }

  public async loadCommandTemplate(commandName: string): Promise<string> {
    log.debug('Loading command template', { source: 'contextLoader#loadCommandTemplate', commandName });
    const template = await this.readFileSafe(path.join(config.context.basePath, 'commands', `${commandName.toLowerCase()}.md`));
    return template;
  }

  public async loadSessionContext(sessionId: string): Promise<string> {
    log.debug('Loading session context', { source: 'contextLoader#loadSessionContext', sessionId });
    const context = await this.readFileSafe(path.join(config.context.basePath, 'sessions', `session_${sessionId}.md`));
    return context;
  }

  public async loadLearnedPatterns(): Promise<string> {
    log.debug('Loading learned patterns', { source: 'contextLoader#loadLearnedPatterns' });
    const patterns = await this.readFileSafe(path.join(config.context.basePath, 'memory', 'learned_patterns.md'));
    return patterns;
  }
}
