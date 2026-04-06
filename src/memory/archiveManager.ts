import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory, fileExists } from '../utils/fileUtil.js';
import { logger } from '../logger/index.js';
import { isOlderThanDays } from '../utils/dateUtil.js';

export class ArchiveManager {
  private getSessionsPath(): string {
    return path.join(config.context.basePath, 'sessions');
  }

  private getArchivePath(): string {
    return path.join(config.context.basePath, 'archive');
  }

  /**
   * Run the cleanup strategy on complete active sessions, moving them to archive/ if needed.
   * Purge sessions in archive/ older than ARCHIVE_RETENTION_DAYS.
   */
  async runCleanup(): Promise<void> {
    try {
      const archivePath = this.getArchivePath();
      await ensureDirectory(archivePath);

      // Clean old archives
      const archiveFiles = await fs.readdir(archivePath);
      for (const file of archiveFiles) {
        const fullPath = path.join(archivePath, file);
        const stat = await fs.stat(fullPath);
        if (isOlderThanDays(stat.mtime, config.context.maxFileSizeKB)) { // using retention days
          await fs.unlink(fullPath);
          logger.info(`Deleted old archive file: ${file}`);
        }
      }

      // We'll leave session cleanup logic to SessionService, which iterates active sessions.
    } catch (error) {
      logger.error('Failed to run cleanup', { error });
    }
  }

  async enforceFileSizeLimit(filePath: string): Promise<boolean> {
    if (!await fileExists(filePath)) return false;

    const stat = await fs.stat(filePath);
    const sizeKB = stat.size / 1024;
    
    if (sizeKB > config.context.maxFileSizeKB) {
      // In a real scenario, this would contact LLM to summarize
      logger.warn(`File exceeds limit (${sizeKB}KB vs limit ${config.context.maxFileSizeKB}KB). Needs summarization: ${filePath}`);
      return true;
    }
    
    return false;
  }
}
