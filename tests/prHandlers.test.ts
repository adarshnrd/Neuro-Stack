import { describe, it, expect, vi } from 'vitest';

// Present GitHub as configured so handlers pass the config guard and reach their logic.
vi.mock('../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/index.js')>();
  return {
    config: {
      ...actual.config,
      github: { ...actual.config.github, owner: 'acme', repo: 'app', token: 'ghp_x', authMode: 'pat', defaultBranch: 'main' },
    },
  };
});

import { CreatePrHandler } from '../src/commands/handlers/createPrHandler.js';
import { PrApproveHandler } from '../src/commands/handlers/prApproveHandler.js';
import { MergePrHandler } from '../src/commands/handlers/mergePrHandler.js';
import { GitService } from '../src/services/gitService.js';
import { GitHubService } from '../src/services/githubService.js';
import { ReviewEvent, MergeMethod } from '../src/enums/gitEnum.js';

const SID = 'session-1';

describe('CreatePrHandler', () => {
  it('branches, commits, pushes, and opens a PR in order', async () => {
    const calls: string[] = [];
    const git = {
      createBranch: vi.fn(async () => { calls.push('branch'); }),
      stageFiles: vi.fn(async () => { calls.push('stage'); }),
      commitChanges: vi.fn(async () => { calls.push('commit'); }),
      pushBranch: vi.fn(async () => { calls.push('push'); }),
    } as unknown as GitService;
    const github = {
      createPullRequest: vi.fn(async () => ({ number: 42, url: 'https://gh/pr/42' })),
    } as unknown as GitHubService;

    const handler = new CreatePrHandler(git, github);
    const result = await handler.execute({ requirement: 'Add health endpoint' }, SID);

    expect(result.success).toBe(true);
    expect(result.message).toContain('#42');
    expect(calls).toEqual(['branch', 'stage', 'commit', 'push']);
    expect((result.data as { prNumber: number }).prNumber).toBe(42);
  });

  it('surfaces a git failure as a friendly error', async () => {
    const git = { createBranch: vi.fn(async () => { throw new Error('not a git repo'); }) } as unknown as GitService;
    const github = {} as unknown as GitHubService;
    const result = await new CreatePrHandler(git, github).execute({ requirement: 'x' }, SID);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not a git repo');
  });
});

describe('PrApproveHandler', () => {
  it('submits an APPROVE review', async () => {
    const submitReview = vi.fn(async () => {});
    const github = { submitReview } as unknown as GitHubService;
    const result = await new PrApproveHandler(github).execute({ prNumber: 7 }, SID);

    expect(result.success).toBe(true);
    expect(submitReview).toHaveBeenCalledWith(7, expect.any(String), ReviewEvent.APPROVE);
  });

  it('requires a PR number', async () => {
    const result = await new PrApproveHandler({} as unknown as GitHubService).execute({}, SID);
    expect(result.success).toBe(false);
    expect(result.message).toContain('@PR_APPROVE');
  });
});

describe('MergePrHandler', () => {
  const openPr = { state: 'open', merged: false, mergeable: true, head: { ref: 'feat' }, base: { ref: 'main' } };

  it('merges an open, mergeable PR with the default method', async () => {
    const mergePullRequest = vi.fn(async () => {});
    const github = { getPullRequest: vi.fn(async () => openPr), mergePullRequest } as unknown as GitHubService;
    const result = await new MergePrHandler(github).execute({ prNumber: 9 }, SID);

    expect(result.success).toBe(true);
    expect(mergePullRequest).toHaveBeenCalledWith(9, MergeMethod.MERGE);
  });

  it('honors an explicit --method', async () => {
    const mergePullRequest = vi.fn(async () => {});
    const github = { getPullRequest: vi.fn(async () => openPr), mergePullRequest } as unknown as GitHubService;
    await new MergePrHandler(github).execute({ prNumber: 9, method: 'squash' }, SID);
    expect(mergePullRequest).toHaveBeenCalledWith(9, MergeMethod.SQUASH);
  });

  it('rejects an invalid merge method without calling the API', async () => {
    const mergePullRequest = vi.fn(async () => {});
    const github = { getPullRequest: vi.fn(), mergePullRequest } as unknown as GitHubService;
    const result = await new MergePrHandler(github).execute({ prNumber: 9, method: 'fastforward' }, SID);
    expect(result.success).toBe(false);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it('refuses to merge a PR with conflicts', async () => {
    const mergePullRequest = vi.fn(async () => {});
    const github = {
      getPullRequest: vi.fn(async () => ({ ...openPr, mergeable: false })),
      mergePullRequest,
    } as unknown as GitHubService;
    const result = await new MergePrHandler(github).execute({ prNumber: 9 }, SID);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/conflict/i);
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it('refuses to merge an already-merged PR', async () => {
    const github = {
      getPullRequest: vi.fn(async () => ({ ...openPr, merged: true })),
      mergePullRequest: vi.fn(),
    } as unknown as GitHubService;
    const result = await new MergePrHandler(github).execute({ prNumber: 9 }, SID);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already merged/i);
  });
});
