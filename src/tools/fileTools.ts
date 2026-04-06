import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { ensureDirectory, fileExists } from '../utils/fileUtil.js';
import { logger } from '../logger/index.js';

const getFullPath = (relativePath: string) => path.join(config.workspace.path, relativePath);

export const readFileTool = tool(
  async ({ relativePath }) => {
    const fullPath = getFullPath(relativePath);
    if (!await fileExists(fullPath)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    return fs.readFile(fullPath, 'utf-8');
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
    }),
  }
);

export const writeFileTool = tool(
  async ({ relativePath, content }) => {
    const fullPath = getFullPath(relativePath);
    await ensureDirectory(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf-8');
    logger.info('File written via tool', { relativePath });
    return `Successfully wrote to ${relativePath}`;
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the workspace with content',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
      content: z.string().describe('The full content to write to the file'),
    }),
  }
);

export const listDirectoryTool = tool(
  async ({ relativePath }) => {
    const fullPath = getFullPath(relativePath || '.');
    if (!await fileExists(fullPath)) {
      throw new Error(`Directory not found: ${relativePath || '.'}`);
    }
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return JSON.stringify(entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    })), null, 2);
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory in the workspace',
    schema: z.object({
      relativePath: z.string().optional().describe('The relative path to the directory (leave empty for root)'),
    }),
  }
);

export const ALL_FILE_TOOLS = [readFileTool, writeFileTool, listDirectoryTool];
