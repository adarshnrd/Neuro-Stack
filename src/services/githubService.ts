import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { config } from '../config/index.js';
import { GitHubApiError } from '../errors/gitError.js';
import { createChildLogger } from '../logger/index.js';
import { MergeMethod, ReviewEvent, PRState } from '../enums/gitEnum.js';

const log = createChildLogger('githubService');

export class GitHubService {
  private readonly octokit: Octokit;

  public constructor() {
    this.octokit = this.initializeOctokit();
  }

  private initializeOctokit(): Octokit {
    if (config.github.authMode === 'app') {
      log.info('Initializing GitHub API with App Auth', { source: 'githubService#initializeOctokit' });
      return new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: config.github.privateKey,
          installationId: config.github.installationId,
        },
      });
    }

    log.info('Initializing GitHub API with PAT Auth', { source: 'githubService#initializeOctokit' });
    return new Octokit({
      auth: config.github.token,
    });
  }

  public async createPullRequest(title: string, head: string, base: string, body: string) {
    const startTime = Date.now();
    try {
      log.info('Creating pull request', { source: 'githubService#createPullRequest', title, head, base });
      const { data } = await this.octokit.rest.pulls.create({
        owner: config.github.owner,
        repo: config.github.repo,
        title,
        head,
        base,
        body,
      });
      log.debug('Pull request created successfully', { source: 'githubService#createPullRequest', prNumber: data.number, durationMs: Date.now() - startTime });
      return {
        number: data.number,
        url: data.html_url,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to create PR', { source: 'githubService#createPullRequest', error: message });
      throw new GitHubApiError('createPR', message, status, { head, base });
    }
  }

  public async getPullRequest(prNumber: number) {
    const startTime = Date.now();
    try {
      log.info('Fetching pull request', { source: 'githubService#getPullRequest', prNumber });
      const { data } = await this.octokit.rest.pulls.get({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
      });
      log.debug('Pull request fetched successfully', { source: 'githubService#getPullRequest', durationMs: Date.now() - startTime });
      return data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to get PR', { source: 'githubService#getPullRequest', error: message });
      throw new GitHubApiError('getPR', message, status, { prNumber });
    }
  }

  public async getPullRequestDiff(prNumber: number): Promise<string> {
    const startTime = Date.now();
    try {
      log.info('Fetching PR diff', { source: 'githubService#getPullRequestDiff', prNumber });
      const { data } = await this.octokit.rest.pulls.get({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        mediaType: {
          format: 'diff',
        },
      });
      const diffStr = data as unknown as string;
      log.debug('PR diff fetched successfully', { source: 'githubService#getPullRequestDiff', diffLength: diffStr.length, durationMs: Date.now() - startTime });
      return diffStr;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to get PR diff', { source: 'githubService#getPullRequestDiff', error: message });
      throw new GitHubApiError('getPRDiff', message, status, { prNumber });
    }
  }

  public async submitReview(prNumber: number, body: string, event: ReviewEvent) {
    const startTime = Date.now();
    try {
      log.info('Submitting PR review', { source: 'githubService#submitReview', prNumber, event });
      await this.octokit.rest.pulls.createReview({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        body,
        event, // APPROVE, REQUEST_CHANGES, COMMENT
      });
      log.debug('PR review submitted successfully', { source: 'githubService#submitReview', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to submit review', { source: 'githubService#submitReview', error: message });
      throw new GitHubApiError('submitReview', message, status, { prNumber, event });
    }
  }

  public async mergePullRequest(prNumber: number, method: MergeMethod = MergeMethod.MERGE) {
    const startTime = Date.now();
    try {
      log.info('Merging PR', { source: 'githubService#mergePullRequest', prNumber, method });
      await this.octokit.rest.pulls.merge({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        merge_method: method,
      });
      log.debug('PR merged successfully', { source: 'githubService#mergePullRequest', durationMs: Date.now() - startTime });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to merge PR', { source: 'githubService#mergePullRequest', error: message });
      throw new GitHubApiError('mergePR', message, status, { prNumber, method });
    }
  }

  public async listPullRequests(state: PRState = PRState.OPEN) {
    const startTime = Date.now();
    try {
      log.info('Listing PRs', { source: 'githubService#listPullRequests', state });
      const { data } = await this.octokit.rest.pulls.list({
        owner: config.github.owner,
        repo: config.github.repo,
        state,
      });
      log.debug('PR list fetched successfully', { source: 'githubService#listPullRequests', count: data.length, durationMs: Date.now() - startTime });
      return data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as any).status : 500;
      log.error('Failed to list PRs', { source: 'githubService#listPullRequests', error: message });
      throw new GitHubApiError('listPRs', message, status, { state });
    }
  }
}
