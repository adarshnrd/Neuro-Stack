import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory } from '../utils/fileUtil.js';
import { GitOperationError } from '../errors/gitError.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('gitService');

export class GitService {
  private readonly git: SimpleGit;
  
  public constructor() {
    this.git = simpleGit(config.workspace.path);
  }

  public async initWorkspace(): Promise<void> {
    log.debug('Ensuring workspace directory exists', { source: 'gitService#initWorkspace', path: config.workspace.path });
    await ensureDirectory(config.workspace.path);
  }

  public async cloneRepository(repoUrl: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Cloning repository', { source: 'gitService#cloneRepository', repoUrl });
      await ensureDirectory(config.workspace.path);
      
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        log.debug('Directory is not a repo, executing clone', { source: 'gitService#cloneRepository' });
        await simpleGit(path.dirname(config.workspace.path)).clone(repoUrl, path.basename(config.workspace.path));
        log.info('Repository cloned successfully', { source: 'gitService#cloneRepository', durationMs: Date.now() - startTime });
      } else {
        log.debug('Directory is already a repo, skipping clone', { source: 'gitService#cloneRepository' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to clone repository', { source: 'gitService#cloneRepository', error: message });
      throw new GitOperationError('clone', message);
    }
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

  public async getCurrentBranch(): Promise<string> {
    try {
      log.debug('Getting current branch', { source: 'gitService#getCurrentBranch' });
      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to get status', { source: 'gitService#getCurrentBranch', error: message });
      throw new GitOperationError('status', message);
    }
  }

  public async getDiff(base: string, head: string): Promise<string> {
    const startTime = Date.now();
    try {
      log.debug('Getting diff', { source: 'gitService#getDiff', base, head });
      const diff = await this.git.diff([`${base}..${head}`]);
      log.debug('Diff retrieved successfully', { source: 'gitService#getDiff', diffLength: diff.length, durationMs: Date.now() - startTime });
      return diff;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to get diff', { source: 'gitService#getDiff', error: message, base, head });
      throw new GitOperationError('diff', message, { base, head });
    }
  }

  public async stashChanges(message?: string): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Stashing changes', { source: 'gitService#stashChanges', message });
      const args = message ? ['save', message] : [];
      await this.git.stash(args);
      log.debug('Changes stashed successfully', { source: 'gitService#stashChanges', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to stash changes', { source: 'gitService#stashChanges', error: message, message });
      throw new GitOperationError('stash', message, { message });
    }
  }

  public async popStash(): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Popping stash', { source: 'gitService#popStash' });
      await this.git.stash(['pop']);
      log.debug('Stash popped successfully', { source: 'gitService#popStash', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to pop stash', { source: 'gitService#popStash', error: message });
      throw new GitOperationError('stashPop', message);
    }
  }

  public async applyStash(stashIndex: number = 0): Promise<void> {
    const startTime = Date.now();
    try {
      log.info('Applying stash', { source: 'gitService#applyStash', stashIndex });
      await this.git.stash(['apply', `stash@{${stashIndex}}`]);
      log.debug('Stash applied successfully', { source: 'gitService#applyStash', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to apply stash', { source: 'gitService#applyStash', error: message, stashIndex });
      throw new GitOperationError('stashApply', message, { stashIndex });
    }
  }
}
