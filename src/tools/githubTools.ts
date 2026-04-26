import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitHubService } from '../services/githubService.js';
import { ReviewEvent, MergeMethod, PRState } from '../enums/gitEnum.js';
import { createChildLogger } from '../logger/index.js';
import { GitHubPullRequest } from '../types/index.js';

const log = createChildLogger('githubTools');
const githubService = new GitHubService();

export const createPullRequest = tool(
  async ({ title, head, base, body }) => {
    log.info('Tool executed: Create Pull Request', { source: 'githubTools#createPullRequest', title, head, base });
    const result = await githubService.createPullRequest(title, head, base, body);
    return `Successfully created PR #${result.number} at ${result.url}`;
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request on GitHub',
    schema: z.object({
      title: z.string().describe('The title of the PR'),
      head: z.string().describe('The branch containing your changes'),
      base: z.string().describe('The branch you want to merge into'),
      body: z.string().describe('The PR description body'),
    }),
  }
);

export const getPullRequest = tool(
  async ({ prNumber }) => {
    log.info('Tool executed: Get Pull Request', { source: 'githubTools#getPullRequest', prNumber });
    const pr = await githubService.getPullRequest(prNumber);
    return JSON.stringify(pr, null, 2);
  },
  {
    name: 'get_pull_request',
    description: 'Get details about a specific pull request',
    schema: z.object({
      prNumber: z.number().describe('The PR number'),
    }),
  }
);

export const getPullRequestDiff = tool(
  async ({ prNumber }) => {
    log.info('Tool executed: Get Pull Request Diff', { source: 'githubTools#getPullRequestDiff', prNumber });
    return await githubService.getPullRequestDiff(prNumber);
  },
  {
    name: 'get_pull_request_diff',
    description: 'Get the raw diff string for a pull request',
    schema: z.object({
      prNumber: z.number().describe('The PR number'),
    }),
  }
);

export const submitReview = tool(
  async ({ prNumber, body, event }) => {
    log.info('Tool executed: Submit Review', { source: 'githubTools#submitReview', prNumber, event });
    await githubService.submitReview(prNumber, body, event as ReviewEvent);
    return `Successfully submitted review for PR #${prNumber} with event ${event}`;
  },
  {
    name: 'submit_review',
    description: 'Submit a review for a pull request (Approve, Request Changes, or Comment)',
    schema: z.object({
      prNumber: z.number().describe('The PR number'),
      body: z.string().describe('The body text of the review'),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('The review action to take'),
    }),
  }
);

// Note: mergePullRequest logic should typically be handled by the explicit handler,
// but we provide it as a tool if needed (though it should be safeguarded).
export const mergePullRequest = tool(
  async ({ prNumber, method }) => {
    log.info('Tool executed: Merge Pull Request', { source: 'githubTools#mergePullRequest', prNumber, method });
    await githubService.mergePullRequest(prNumber, method as MergeMethod);
    return `Successfully merged PR #${prNumber} using ${method || 'merge'} method.`;
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request. DANGER: use only when explicit user command allows it.',
    schema: z.object({
      prNumber: z.number().describe('The PR number'),
      method: z.enum(['merge', 'squash', 'rebase']).optional().describe('The merge method'),
    }),
  }
);

export const listPullRequests = tool(
  async ({ state }) => {
    log.info('Tool executed: List Pull Requests', { source: 'githubTools#listPullRequests', state });
    const prs = await githubService.listPullRequests((state as PRState) || PRState.OPEN);
    return JSON.stringify(prs.map((pr: any): GitHubPullRequest => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
    })), null, 2);
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests in the repository',
    schema: z.object({
      state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state (default open)'),
    }),
  }
);

export const ALL_GITHUB_TOOLS = [
  createPullRequest,
  getPullRequest,
  getPullRequestDiff,
  submitReview,
  mergePullRequest,
  listPullRequests,
];
