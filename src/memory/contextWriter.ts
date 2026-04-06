import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory } from '../utils/fileUtil.js';

export class ContextWriter {
  private async appendToFileSafe(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(config.context.basePath, relativePath);
    await ensureDirectory(path.dirname(fullPath));
    await fs.appendFile(fullPath, `\n${content}\n`, 'utf-8');
  }

  async appendRule(content: string, type: 'system' | 'anti_hallucination'): Promise<void> {
    const filename = type === 'system' ? 'system_rules.md' : 'anti_hallucination.md';
    await this.appendToFileSafe(path.join('rules', filename), content);
  }

  async appendLearnedPattern(pattern: string): Promise<void> {
    await this.appendToFileSafe(path.join('memory', 'learned_patterns.md'), `- ${pattern}`);
  }
}
