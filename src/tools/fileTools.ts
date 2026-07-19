import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'fs/promises';
import { config } from '../config/index.js';
import { fileExists, resolveInsideRoot, writeFileTransactional } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';
import { changeSetService } from '../services/changeSetService.js';
import { changeSetContext } from '../services/changeSetContext.js';
import { getWorkspaceSession } from '../services/workspaceContext.js';
import { WorkspaceWriteMode } from '../enums/workspaceEnum.js';

const log = createChildLogger('fileTools');

/** Active workspace root: the selected folder-agent session, else the global workspace. */
function getWorkspaceRoot(): string {
  return getWorkspaceSession()?.rootDir ?? config.workspace.path;
}

/** True when the active session applies writes directly to the folder (no staging). */
function isDirectApply(): boolean {
  return getWorkspaceSession()?.writeMode === WorkspaceWriteMode.DIRECT;
}

// Paths come from the LLM — resolveInsideRoot throws if one escapes the workspace root
const getFullPath = (relativePath: string) => resolveInsideRoot(getWorkspaceRoot(), relativePath);

const CRITICAL_DIRECTORIES = ['src/config/'];

function isCriticalDirectory(relativePath: string): boolean {
  return CRITICAL_DIRECTORIES.some(dir => relativePath.startsWith(dir));
}

export const readFileTool = tool(
  async ({ relativePath }) => {
    log.info('Tool executed: Read File', { source: 'fileTools#readFileTool', relativePath });

    // Within a changeset, staged edits are the current state — return them so
    // multi-iteration loops see their own uncommitted writes, not stale disk.
    const changeSetId = changeSetContext.getStore();
    if (changeSetId) {
      const staged = changeSetService.getStagedContent(changeSetId, relativePath);
      if (staged !== undefined) {
        log.debug('Returning staged content for file', { source: 'fileTools#readFileTool', relativePath });
        return staged;
      }
    }

    const fullPath = getFullPath(relativePath);
    if (!await fileExists(fullPath)) {
      log.warn('File not found in tool execution', { source: 'fileTools#readFileTool', relativePath });
      throw new Error(`File not found: ${relativePath}`);
    }
    const content = await fs.readFile(fullPath, 'utf-8');
    log.debug('File read successfully via tool', { source: 'fileTools#readFileTool', relativePath, length: content.length });
    return content;
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
  async ({ relativePath, content, directWrite }) => {
    const changeSetId = changeSetContext.getStore();
    log.info('Tool executed: Write File', { source: 'fileTools#writeFileTool', relativePath, length: content.length, directWrite, changeSetId });
    const fullPath = getFullPath(relativePath);

    // Folder-agent direct-apply: write transactionally into the selected folder.
    // The user owns the folder, so the critical-directory guard (which protects
    // NeuroStack's own config) does not apply here.
    if (isDirectApply()) {
      await getWorkspaceSession()?.onSnapshot?.(relativePath, fullPath);
      await writeFileTransactional(fullPath, content);
      log.debug('File written directly (folder-agent) via tool', { source: 'fileTools#writeFileTool', relativePath });
      return `Wrote ${relativePath}`;
    }

    // If explicit direct write or no changeset context exists, write directly to disk
    if (directWrite || !changeSetId) {
      if (isCriticalDirectory(relativePath)) {
        throw new Error(`Direct writes are guarded for critical directory: ${relativePath}`);
      }
      await writeFileTransactional(fullPath, content);
      log.debug('File written directly via tool', { source: 'fileTools#writeFileTool', relativePath });
      return `Successfully performed direct write to ${relativePath}`;
    }

    // Otherwise, use staging/review flow
    let originalContent = '';
    if (await fileExists(fullPath)) {
      originalContent = await fs.readFile(fullPath, 'utf-8');
    }

    await changeSetService.addFileChange(changeSetId, relativePath, originalContent, content);
    log.debug('File change staged successfully', { source: 'fileTools#writeFileTool', relativePath });
    return `Staged change to ${relativePath} — awaiting user review.`;
  },
  {
    name: 'write_file',
    description: 'Create or update a file. By default this stages changes for user review. Only use directWrite: true for critical/system internal operations that explicitly bypass review.',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
      content: z.string().describe('The full content to write to the file'),
      directWrite: z.boolean().optional().default(false).describe('Set to true to bypass review and write directly. Use sparingly.'),
    }),
  }
);

export const deleteFileTool = tool(
  async ({ relativePath, directWrite }) => {
    const changeSetId = changeSetContext.getStore();
    log.info('Tool executed: Delete File', { source: 'fileTools#deleteFileTool', relativePath, directWrite, changeSetId });
    const fullPath = getFullPath(relativePath);

    if (!await fileExists(fullPath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    // Folder-agent direct-apply: delete straight from the selected folder.
    if (isDirectApply()) {
      await getWorkspaceSession()?.onSnapshot?.(relativePath, fullPath);
      await fs.unlink(fullPath);
      log.debug('File deleted directly (folder-agent) via tool', { source: 'fileTools#deleteFileTool', relativePath });
      return `Deleted ${relativePath}`;
    }

    // If explicit direct write or no changeset context exists, delete directly
    if (directWrite || !changeSetId) {
      if (isCriticalDirectory(relativePath)) {
        throw new Error(`Direct deletion is guarded for critical directory: ${relativePath}`);
      }
      await fs.unlink(fullPath);
      log.debug('File deleted directly via tool', { source: 'fileTools#deleteFileTool', relativePath });
      return `Successfully performed direct deletion of ${relativePath}`;
    }

    // Stage deletion
    const originalContent = await fs.readFile(fullPath, 'utf-8');
    await changeSetService.addFileChange(changeSetId, relativePath, originalContent, '');
    log.debug('File deletion staged successfully', { source: 'fileTools#deleteFileTool', relativePath });
    return `Staged deletion of ${relativePath} — awaiting user review.`;
  },
  {
    name: 'delete_file',
    description: 'Delete a file. By default this stages changes for user review. Only use directWrite: true for critical internal operations that explicitly bypass review.',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
      directWrite: z.boolean().optional().default(false).describe('Set to true to bypass review and delete directly. Use sparingly.'),
    }),
  }
);

export const listDirectoryTool = tool(
  async ({ relativePath }) => {
    log.info('Tool executed: List Directory', { source: 'fileTools#listDirectoryTool', relativePath: relativePath || '.' });
    const fullPath = getFullPath(relativePath || '.');
    if (!await fileExists(fullPath)) {
      log.warn('Directory not found in tool execution', { source: 'fileTools#listDirectoryTool', relativePath: relativePath || '.' });
      throw new Error(`Directory not found: ${relativePath || '.'}`);
    }
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    log.debug('Directory listed successfully via tool', { source: 'fileTools#listDirectoryTool', count: entries.length });
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

export const ALL_FILE_TOOLS = [readFileTool, writeFileTool, deleteFileTool, listDirectoryTool];
