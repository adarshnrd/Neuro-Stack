import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('contextWriter');

export class ContextWriter {
  private async appendToFileSafe(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(config.context.basePath, relativePath);
    log.debug('Appending content to file', { source: 'contextWriter#appendToFileSafe', relativePath, length: content.length });
    await ensureDirectory(path.dirname(fullPath));
    await fs.appendFile(fullPath, `\n${content}\n`, 'utf-8');
  }

  public async appendRule(content: string, type: 'system' | 'anti_hallucination'): Promise<void> {
    log.debug('Appending rule', { source: 'contextWriter#appendRule', type });
    const filename = type === 'system' ? 'system_rules.md' : 'anti_hallucination.md';
    await this.appendToFileSafe(path.join('rules', filename), content);
  }

  public async appendLearnedPattern(pattern: string): Promise<void> {
    log.debug('Appending learned pattern', { source: 'contextWriter#appendLearnedPattern' });
    await this.appendToFileSafe(path.join('memory', 'learned_patterns.md'), `- ${pattern}`);
  }
}
