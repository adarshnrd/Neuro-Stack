import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { openWorkspace, isSensitiveRoot } from '../src/services/workspaceService.js';
import { WorkspaceWriteMode, PermissionMode } from '../src/enums/workspaceEnum.js';

describe('isSensitiveRoot', () => {
  it('flags the filesystem root and home directory', () => {
    expect(isSensitiveRoot(path.parse(process.cwd()).root)).toBe(true);
    expect(isSensitiveRoot(os.homedir())).toBe(true);
  });

  it('allows ordinary project directories', () => {
    expect(isSensitiveRoot(path.join(os.homedir(), 'projects', 'my-app'))).toBe(false);
  });
});

describe('openWorkspace', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-ws-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('opens a valid directory with default direct/auto modes', async () => {
    const session = await openWorkspace(dir);
    expect(session.rootDir).toBe(path.resolve(dir));
    expect(session.writeMode).toBe(WorkspaceWriteMode.DIRECT);
    expect(session.permissionMode).toBe(PermissionMode.AUTO);
  });

  it('honors explicit modes', async () => {
    const session = await openWorkspace(dir, {
      writeMode: WorkspaceWriteMode.STAGED,
      permissionMode: PermissionMode.MANUAL,
    });
    expect(session.writeMode).toBe(WorkspaceWriteMode.STAGED);
    expect(session.permissionMode).toBe(PermissionMode.MANUAL);
  });

  it('rejects a non-existent path', async () => {
    await expect(openWorkspace(path.join(dir, 'nope'))).rejects.toThrow(/does not exist/i);
  });

  it('rejects a file (not a directory)', async () => {
    const file = path.join(dir, 'f.txt');
    await fs.writeFile(file, 'x');
    await expect(openWorkspace(file)).rejects.toThrow(/not a directory/i);
  });

  it('refuses the home directory', async () => {
    await expect(openWorkspace(os.homedir())).rejects.toThrow(/sensitive root/i);
  });
});
