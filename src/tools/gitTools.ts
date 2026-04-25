import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitService } from '../services/gitService.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('gitTools');
const gitService = new GitService();

export const cloneRepository = tool(
  async ({ url }) => {
    log.info('Tool executed: Clone Repository', { source: 'gitTools#cloneRepository', url });
    await gitService.cloneRepository(url);
    return `Successfully cloned ${url}`;
  },
  {
    name: 'clone_repository',
    description: 'Clone a git repository to the local workspace',
    schema: z.object({
      url: z.string().describe('The URL of the git repository to clone'),
    }),
  }
);

export const createBranch = tool(
  async ({ branchName }) => {
    log.info('Tool executed: Create Branch', { source: 'gitTools#createBranch', branchName });
    await gitService.createBranch(branchName);
    return `Successfully created and checked out branch ${branchName}`;
  },
  {
    name: 'create_branch',
    description: 'Create and checkout a new local git branch',
    schema: z.object({
      branchName: z.string().describe('The name of the branch to create'),
    }),
  }
);

export const checkoutBranch = tool(
  async ({ branchName }) => {
    log.info('Tool executed: Checkout Branch', { source: 'gitTools#checkoutBranch', branchName });
    await gitService.checkoutBranch(branchName);
    return `Successfully checked out branch ${branchName}`;
  },
  {
    name: 'checkout_branch',
    description: 'Check out an existing git branch',
    schema: z.object({
      branchName: z.string().describe('The name of the branch to check out'),
    }),
  }
);

export const stageFiles = tool(
  async ({ files }) => {
    log.info('Tool executed: Stage Files', { source: 'gitTools#stageFiles', fileCount: files?.length || 'all' });
    await gitService.stageFiles(files);
    return `Successfully staged files: ${files ? files.join(', ') : 'all files'}`;
  },
  {
    name: 'stage_files',
    description: 'Stage files for commit. If files is omitted, stages all changes.',
    schema: z.object({
      files: z.array(z.string()).optional().describe('Optional list of specific files to stage'),
    }),
  }
);

export const commitChanges = tool(
  async ({ message }) => {
    log.info('Tool executed: Commit Changes', { source: 'gitTools#commitChanges', messageLength: message.length });
    await gitService.commitChanges(message);
    return `Successfully committed changes with message: "${message}"`;
  },
  {
    name: 'commit_changes',
    description: 'Commit staged changes to the local repository',
    schema: z.object({
      message: z.string().describe('The commit message'),
    }),
  }
);

export const pushBranch = tool(
  async ({ branchName }) => {
    log.info('Tool executed: Push Branch', { source: 'gitTools#pushBranch', branchName });
    await gitService.pushBranch(branchName);
    return `Successfully pushed branch ${branchName} to origin`;
  },
  {
    name: 'push_branch',
    description: 'Push a local branch to the remote origin',
    schema: z.object({
      branchName: z.string().describe('The name of the branch to push'),
    }),
  }
);

export const getCurrentBranch = tool(
  async () => {
    log.info('Tool executed: Get Current Branch', { source: 'gitTools#getCurrentBranch' });
    const branch = await gitService.getCurrentBranch();
    return `Current branch is ${branch}`;
  },
  {
    name: 'get_current_branch',
    description: 'Get the name of the currently checked out branch',
    schema: z.object({}),
  }
);

export const getDiff = tool(
  async ({ base, head }) => {
    log.info('Tool executed: Get Diff', { source: 'gitTools#getDiff', base, head });
    return await gitService.getDiff(base, head);
  },
  {
    name: 'get_diff',
    description: 'Get the git diff between two branches or commits',
    schema: z.object({
      base: z.string().describe('The base branch or commit (e.g. main)'),
      head: z.string().describe('The head branch or commit (e.g. HEAD)'),
    }),
  }
);

export const stashChanges = tool(
  async ({ message }) => {
    log.info('Tool executed: Stash Changes', { source: 'gitTools#stashChanges', message });
    await gitService.stashChanges(message);
    return `Successfully stashed changes${message ? ` with message: "${message}"` : ''}`;
  },
  {
    name: 'stash_changes',
    description: 'Stash currently modified but uncommitted files',
    schema: z.object({
      message: z.string().optional().describe('Optional message for the stash entry'),
    }),
  }
);

export const popStash = tool(
  async () => {
    log.info('Tool executed: Pop Stash', { source: 'gitTools#popStash' });
    await gitService.popStash();
    return 'Successfully popped the latest stash';
  },
  {
    name: 'pop_stash',
    description: 'Pop the most recent stash onto the current working tree, removing it from the stash list',
    schema: z.object({}),
  }
);

export const applyStash = tool(
  async ({ stashIndex }) => {
    log.info('Tool executed: Apply Stash', { source: 'gitTools#applyStash', stashIndex });
    await gitService.applyStash(stashIndex);
    return `Successfully applied stash@{${stashIndex}}`;
  },
  {
    name: 'apply_stash',
    description: 'Apply a specific stash without removing it from the stash list. Defaults to the most recent stash (0) if not specified.',
    schema: z.object({
      stashIndex: z.number().default(0).describe('The index of the stash to apply (e.g. 0 for stash@{0})'),
    }),
  }
);

export const ALL_GIT_TOOLS = [
  cloneRepository,
  createBranch,
  checkoutBranch,
  stageFiles,
  commitChanges,
  pushBranch,
  getCurrentBranch,
  getDiff,
  stashChanges,
  popStash,
  applyStash,
];
