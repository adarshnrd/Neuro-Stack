import { simpleGit, SimpleGit } from 'simple-git';
import { config } from '../config/index.js';
import { GitOperationError } from '../errors/gitError.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('gitService');

export class GitService {
  private readonly git: SimpleGit;
  
  public constructor() {
    this.git = simpleGit(config.workspace.path);
  }

  public async createBranch(branchName: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Creating branch', { source: 'gitService#createBranch', branchName });
      await this.git.checkoutLocalBranch(branchName);
      log.debug('Branch created successfully', { source: 'gitService#createBranch', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to create branch', { source: 'gitService#createBranch', error: message, branchName });
      throw new GitOperationError('checkoutLocalBranch', message, { branchName });
    }
  }

  public async checkoutBranch(branchName: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Checking out branch', { source: 'gitService#checkoutBranch', branchName });
      await this.git.checkout(branchName);
      log.debug('Branch checked out successfully', { source: 'gitService#checkoutBranch', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to checkout branch', { source: 'gitService#checkoutBranch', error: message, branchName });
      throw new GitOperationError('checkout', message, { branchName });
    }
  }

  public async stageFiles(files?: string[]): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Staging files', { source: 'gitService#stageFiles', files: files || 'all' });
      await this.git.add(files || ['./*']);
      log.debug('Files staged successfully', { source: 'gitService#stageFiles', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to stage files', { source: 'gitService#stageFiles', error: message, files });
      throw new GitOperationError('add', message, { files });
    }
  }

  public async commitChanges(message: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Committing changes', { source: 'gitService#commitChanges', messageLength: message.length });
      await this.git.commit(message);
      log.debug('Changes committed successfully', { source: 'gitService#commitChanges', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to commit changes', { source: 'gitService#commitChanges', error: message });
      throw new GitOperationError('commit', message, { message });
    }
  }

  public async pushBranch(branchName: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Pushing branch', { source: 'gitService#pushBranch', branchName });
      await this.git.push('origin', branchName, ['--set-upstream']);
      log.debug('Branch pushed successfully', { source: 'gitService#pushBranch', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to push branch', { source: 'gitService#pushBranch', error: message, branchName });
      throw new GitOperationError('push', message, { branchName });
    }
  }
}
