import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitService } from '../services/gitService.js';

const gitService = new GitService();

export const cloneRepository = tool(
  async ({ url }) => {
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

export const ALL_GIT_TOOLS = [
  cloneRepository,
  createBranch,
  checkoutBranch,
  stageFiles,
  commitChanges,
  pushBranch,
  getCurrentBranch,
  getDiff,
];
