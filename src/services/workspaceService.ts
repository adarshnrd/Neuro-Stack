import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { constants as fsConstants } from 'fs';
import { WorkspaceWriteMode, PermissionMode } from '../enums/workspaceEnum.js';
import { ApprovalBroker, WorkspaceSession } from '../types/workspaceTypes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('workspaceService');

export interface OpenWorkspaceOptions {
  writeMode?: WorkspaceWriteMode;
  permissionMode?: PermissionMode;
  approvalBroker?: ApprovalBroker;
}

/**
 * Validates and opens a folder as an agent workspace.
 *
 * Guards: the path must exist, be a directory, be writable, and not be a
 * sensitive root (filesystem root or the user's home directory) — those are
 * refused so an autonomous agent can never be pointed at the whole machine.
 */
export async function openWorkspace(
  rootDirInput: string,
  options: OpenWorkspaceOptions = {},
): Promise<WorkspaceSession> {
  const rootDir = path.resolve(rootDirInput);

  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat) throw new Error(`Folder does not exist: ${rootDir}`);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${rootDir}`);

  if (isSensitiveRoot(rootDir)) {
    throw new Error(`Refusing to open a sensitive root directory: ${rootDir}`);
  }

  try {
    await fs.access(rootDir, fsConstants.W_OK);
  } catch {
    throw new Error(`Folder is not writable: ${rootDir}`);
  }

  const session: WorkspaceSession = {
    rootDir,
    writeMode: options.writeMode ?? WorkspaceWriteMode.DIRECT,
    permissionMode: options.permissionMode ?? PermissionMode.AUTO,
    approvalBroker: options.approvalBroker,
  };

  log.info('Workspace opened', {
    source: 'workspaceService#openWorkspace',
    rootDir,
    writeMode: session.writeMode,
    permissionMode: session.permissionMode,
  });

  return session;
}

/** True for the filesystem root or the user's home directory. */
export function isSensitiveRoot(resolvedPath: string): boolean {
  const normalized = resolvedPath.replace(/[/\\]+$/, '') || path.parse(resolvedPath).root.replace(/[/\\]+$/, '');
  const roots = [
    path.parse(resolvedPath).root.replace(/[/\\]+$/, ''),
    os.homedir().replace(/[/\\]+$/, ''),
  ];
  return roots.includes(normalized);
}
