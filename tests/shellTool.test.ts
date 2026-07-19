import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { runCommandTool } from '../src/tools/shellTools.js';
import { workspaceContext } from '../src/services/workspaceContext.js';
import { WorkspaceWriteMode, PermissionMode } from '../src/enums/workspaceEnum.js';
import { ApprovalRequest, WorkspaceSession } from '../src/types/workspaceTypes.js';

function session(overrides: Partial<WorkspaceSession>): WorkspaceSession {
  return {
    rootDir: overrides.rootDir ?? process.cwd(),
    writeMode: WorkspaceWriteMode.DIRECT,
    permissionMode: overrides.permissionMode ?? PermissionMode.AUTO,
    approvalBroker: overrides.approvalBroker,
  };
}

const invoke = (cmd: string) => runCommandTool.invoke({ command: cmd });

describe('run_command tool', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-shell-test-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('refuses when there is no active workspace session', async () => {
    const result = await invoke('echo hi');
    expect(result).toMatch(/only available in a folder-agent session/i);
  });

  it('runs a normal command without approval in AUTO mode', async () => {
    const broker = vi.fn(async () => true);
    const result = await workspaceContext.run(
      session({ rootDir: dir, permissionMode: PermissionMode.AUTO, approvalBroker: broker }),
      () => invoke('echo hello-neurostack'),
    );
    expect(broker).not.toHaveBeenCalled();
    expect(result).toContain('hello-neurostack');
    expect(result).toContain('exit 0');
  });

  it('asks the broker for a high-risk command in AUTO mode and denies on refusal', async () => {
    const broker = vi.fn(async (_req: ApprovalRequest) => false);
    const result = await workspaceContext.run(
      session({ rootDir: dir, permissionMode: PermissionMode.AUTO, approvalBroker: broker }),
      () => invoke('rm -rf something'),
    );
    expect(broker).toHaveBeenCalledOnce();
    expect(broker.mock.calls[0][0].risk).toBe('high');
    expect(result).toMatch(/denied/i);
  });

  it('asks the broker for EVERY command in MANUAL mode', async () => {
    const broker = vi.fn(async () => true);
    await workspaceContext.run(
      session({ rootDir: dir, permissionMode: PermissionMode.MANUAL, approvalBroker: broker }),
      () => invoke('echo hi'),
    );
    expect(broker).toHaveBeenCalledOnce();
  });

  it('does not run a high-risk command when no broker is available', async () => {
    const result = await workspaceContext.run(
      session({ rootDir: dir, permissionMode: PermissionMode.AUTO }),
      () => invoke('git push --force'),
    );
    expect(result).toMatch(/requires approval/i);
  });

  it('locks execution to the workspace root (cwd)', async () => {
    const result = await workspaceContext.run(
      session({ rootDir: dir, permissionMode: PermissionMode.AUTO }),
      () => invoke('pwd'),
    );
    expect(result).toContain(await fs.realpath(dir));
  });
});
