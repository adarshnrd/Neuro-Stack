import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory } from '../utils/fileUtil.js';
import { GitOperationError } from '../errors/gitError.js';
import { logger } from '../logger/index.js';

export class GitService {
  private git: SimpleGit;
  
  constructor() {
    this.git = simpleGit(config.workspace.path);
  }

  async initWorkspace(): Promise<void> {
    await ensureDirectory(config.workspace.path);
    // In actual implementation we might clone or init
  }

  async cloneRepository(repoUrl: string): Promise<void> {
    try {
      logger.info('Cloning repository', { repoUrl });
      await ensureDirectory(config.workspace.path);
      // clean before clone or clone if empty
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        await simpleGit(path.dirname(config.workspace.path)).clone(repoUrl, path.basename(config.workspace.path));
      }
    } catch (error: any) {
      logger.error('Failed to clone repository', { error });
      throw new GitOperationError('clone', error.message);
    }
  }

  async createBranch(branchName: string): Promise<void> {
    try {
      logger.info('Creating branch', { branchName });
      await this.git.checkoutLocalBranch(branchName);
    } catch (error: any) {
      throw new GitOperationError('checkoutLocalBranch', error.message, { branchName });
    }
  }

  async checkoutBranch(branchName: string): Promise<void> {
    try {
      logger.info('Checking out branch', { branchName });
      await this.git.checkout(branchName);
    } catch (error: any) {
      throw new GitOperationError('checkout', error.message, { branchName });
    }
  }

  async stageFiles(files?: string[]): Promise<void> {
    try {
      logger.info('Staging files', { files: files || 'all' });
      await this.git.add(files || ['./*']);
    } catch (error: any) {
      throw new GitOperationError('add', error.message, { files });
    }
  }

  async commitChanges(message: string): Promise<void> {
    try {
      logger.info('Committing changes', { message });
      await this.git.commit(message);
    } catch (error: any) {
      throw new GitOperationError('commit', error.message, { message });
    }
  }

  async pushBranch(branchName: string): Promise<void> {
    try {
      logger.info('Pushing branch', { branchName });
      await this.git.push('origin', branchName, ['--set-upstream']);
    } catch (error: any) {
      throw new GitOperationError('push', error.message, { branchName });
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error: any) {
      throw new GitOperationError('status', error.message);
    }
  }

  async getDiff(base: string, head: string): Promise<string> {
    try {
      return await this.git.diff([`${base}..${head}`]);
    } catch (error: any) {
      throw new GitOperationError('diff', error.message, { base, head });
    }
  }
}
