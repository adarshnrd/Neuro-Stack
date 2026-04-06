import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { config } from '../config/index.js';
import { GitHubApiError } from '../errors/gitError.js';
import { logger } from '../logger/index.js';
import { MergeMethod, ReviewEvent, PRState } from '../enums/gitEnum.js';

export class GitHubService {
  private octokit: Octokit;

  constructor() {
    this.octokit = this.initializeOctokit();
  }

  private initializeOctokit(): Octokit {
    if (config.github.authMode === 'app') {
      logger.info('Initializing GitHub API with App Auth');
      return new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.github.appId,
          privateKey: config.github.privateKey,
          installationId: config.github.installationId,
        },
      });
    }

    logger.info('Initializing GitHub API with PAT Auth');
    return new Octokit({
      auth: config.github.token,
    });
  }

  async createPullRequest(title: string, head: string, base: string, body: string) {
    try {
      logger.info('Creating pull request', { title, head, base });
      const { data } = await this.octokit.rest.pulls.create({
        owner: config.github.owner,
        repo: config.github.repo,
        title,
        head,
        base,
        body,
      });
      return {
        number: data.number,
        url: data.html_url,
      };
    } catch (error: any) {
      throw new GitHubApiError('createPR', error.message, error.status, { head, base });
    }
  }

  async getPullRequest(prNumber: number) {
    try {
      logger.info('Fetching pull request', { prNumber });
      const { data } = await this.octokit.rest.pulls.get({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
      });
      return data;
    } catch (error: any) {
      throw new GitHubApiError('getPR', error.message, error.status, { prNumber });
    }
  }

  async getPullRequestDiff(prNumber: number): Promise<string> {
    try {
      logger.info('Fetching PR diff', { prNumber });
      const { data } = await this.octokit.rest.pulls.get({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        mediaType: {
          format: 'diff',
        },
      });
      return data as unknown as string;
    } catch (error: any) {
      throw new GitHubApiError('getPRDiff', error.message, error.status, { prNumber });
    }
  }

  async submitReview(prNumber: number, body: string, event: ReviewEvent) {
    try {
      logger.info('Submitting PR review', { prNumber, event });
      await this.octokit.rest.pulls.createReview({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        body,
        event, // APPROVE, REQUEST_CHANGES, COMMENT
      });
    } catch (error: any) {
      throw new GitHubApiError('submitReview', error.message, error.status, { prNumber, event });
    }
  }

  async mergePullRequest(prNumber: number, method: MergeMethod = MergeMethod.MERGE) {
    try {
      logger.info('Merging PR', { prNumber, method });
      await this.octokit.rest.pulls.merge({
        owner: config.github.owner,
        repo: config.github.repo,
        pull_number: prNumber,
        merge_method: method,
      });
    } catch (error: any) {
      throw new GitHubApiError('mergePR', error.message, error.status, { prNumber, method });
    }
  }

  async listPullRequests(state: PRState = PRState.OPEN) {
    try {
      logger.info('Listing PRs', { state });
      const { data } = await this.octokit.rest.pulls.list({
        owner: config.github.owner,
        repo: config.github.repo,
        state,
      });
      return data;
    } catch (error: any) {
      throw new GitHubApiError('listPRs', error.message, error.status, { state });
    }
  }
}
