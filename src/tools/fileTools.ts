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

/** Error raised when a mutating tool runs outside both a changeset and a folder-agent session. */
const NO_WRITE_CONTEXT = 'No active changeset or folder-agent session — refusing to modify files without review.';

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
  async ({ relativePath, content }) => {
    const changeSetId = changeSetContext.getStore();
    log.info('Tool executed: Write File', { source: 'fileTools#writeFileTool', relativePath, length: content.length, changeSetId });
    const fullPath = getFullPath(relativePath);

    // Folder-agent direct-apply: write transactionally into the user's selected folder.
    if (isDirectApply()) {
      await getWorkspaceSession()?.onSnapshot?.(relativePath, fullPath);
      await writeFileTransactional(fullPath, content);
      log.debug('File written directly (folder-agent) via tool', { source: 'fileTools#writeFileTool', relativePath });
      return `Wrote ${relativePath}`;
    }

    // Everywhere else writes are staged for human review — there is no bypass.
    if (!changeSetId) throw new Error(NO_WRITE_CONTEXT);

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
    description: 'Create or update a file with its complete new contents. Changes are staged for user review unless running as the folder agent.',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
      content: z.string().describe('The full content to write to the file'),
    }),
  }
);

export const deleteFileTool = tool(
  async ({ relativePath }) => {
    const changeSetId = changeSetContext.getStore();
    log.info('Tool executed: Delete File', { source: 'fileTools#deleteFileTool', relativePath, changeSetId });
    const fullPath = getFullPath(relativePath);

    if (!await fileExists(fullPath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    // Folder-agent direct-apply: delete straight from the selected folder (snapshotted first).
    if (isDirectApply()) {
      await getWorkspaceSession()?.onSnapshot?.(relativePath, fullPath);
      await fs.unlink(fullPath);
      log.debug('File deleted directly (folder-agent) via tool', { source: 'fileTools#deleteFileTool', relativePath });
      return `Deleted ${relativePath}`;
    }

    if (!changeSetId) throw new Error(NO_WRITE_CONTEXT);

    const originalContent = await fs.readFile(fullPath, 'utf-8');
    await changeSetService.addFileChange(changeSetId, relativePath, originalContent, '');
    log.debug('File deletion staged successfully', { source: 'fileTools#deleteFileTool', relativePath });
    return `Staged deletion of ${relativePath} — awaiting user review.`;
  },
  {
    name: 'delete_file',
    description: 'Delete a file. Deletions are staged for user review unless running as the folder agent.',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
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
