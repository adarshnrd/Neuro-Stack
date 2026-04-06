import fs from 'fs/promises';
import path from 'path';
import { fileExists, ensureDirectory } from '../utils/fileUtil.js';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

export class ContextLoader {
  private async readFileSafe(filePath: string): Promise<string> {
    if (await fileExists(filePath)) {
      return fs.readFile(filePath, 'utf-8');
    }
    return '';
  }

  async loadRules(): Promise<string> {
    const systemRules = await this.readFileSafe(path.join(config.context.basePath, 'rules', 'system_rules.md'));
    const antiHallucination = await this.readFileSafe(path.join(config.context.basePath, 'rules', 'anti_hallucination.md'));
    const guidelines = await this.readFileSafe(path.join(config.context.basePath, 'agents', 'code_generation_guidelines.md'));
    
    return [systemRules, antiHallucination, guidelines].filter(Boolean).join('\n\n');
  }

  async loadCommandTemplate(commandName: string): Promise<string> {
    return this.readFileSafe(path.join(config.context.basePath, 'commands', `${commandName.toLowerCase()}.md`));
  }

  async loadSessionContext(sessionId: string): Promise<string> {
    return this.readFileSafe(path.join(config.context.basePath, 'sessions', `session_${sessionId}.md`));
  }

  async loadLearnedPatterns(): Promise<string> {
    return this.readFileSafe(path.join(config.context.basePath, 'memory', 'learned_patterns.md'));
  }
}
