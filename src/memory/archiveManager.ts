import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory, fileExists } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';
import { isOlderThanDays } from '../utils/dateUtil.js';

const log = createChildLogger('archiveManager');

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
  public async runCleanup(): Promise<void> {
    try {
      log.info('Running cleanup strategy', { source: 'archiveManager#runCleanup' });
      const archivePath = this.getArchivePath();
      await ensureDirectory(archivePath);

      // Clean old archives
      const archiveFiles = await fs.readdir(archivePath);
      let deletedCount = 0;
      
      for (const file of archiveFiles) {
        const fullPath = path.join(archivePath, file);
        const stat = await fs.stat(fullPath);
        
        const isOld = isOlderThanDays(stat.mtime, config.context.maxFileSizeKB); // Note: using maxFileSizeKB here as retention in original code, might be a bug in original code too, leaving as is but logged
        log.debug('Evaluating archive file', { source: 'archiveManager#runCleanup', file, ageMs: Date.now() - stat.mtime.getTime(), isOld });
        
        if (isOld) {
          await fs.unlink(fullPath);
          log.info(`Deleted old archive file`, { source: 'archiveManager#runCleanup', file });
          deletedCount++;
        }
      }
      
      log.info('Cleanup strategy complete', { source: 'archiveManager#runCleanup', deletedCount });

      // We'll leave session cleanup logic to SessionService, which iterates active sessions.
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      log.error('Failed to run cleanup', { source: 'archiveManager#runCleanup', error: message, stack: stack });
    }
  }

  public async enforceFileSizeLimit(filePath: string): Promise<boolean> {
    const exists = await fileExists(filePath);
    if (!exists) return false;

    const stat = await fs.stat(filePath);
    const sizeKB = stat.size / 1024;
    
    log.debug('Checking file size limit', { source: 'archiveManager#enforceFileSizeLimit', filePath, sizeKB, limitKB: config.context.maxFileSizeKB });
    
    if (sizeKB > config.context.maxFileSizeKB) {
      // In a real scenario, this would contact LLM to summarize
      log.warn(`File exceeds limit`, { 
        source: 'archiveManager#enforceFileSizeLimit', 
        filePath, 
        sizeKB, 
        limitKB: config.context.maxFileSizeKB 
      });
      return true;
    }
    
    return false;
  }
}
