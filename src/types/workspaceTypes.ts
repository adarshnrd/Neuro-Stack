import { CommandRisk, PermissionMode, WorkspaceWriteMode } from '../enums/workspaceEnum.js';

/**
 * A request for the user to approve a potentially risky operation.
 * Surfaced by the command policy when a command needs confirmation.
 */
export interface ApprovalRequest {
  kind: 'command';
  command: string;
  risk: CommandRisk;
  reason: string;
}

/**
 * Resolves an approval request to allow (true) or deny (false).
 * Frontends supply their own: readline prompt (CLI), interrupt round-trip
 * (web), or a fixed policy (tests/eval).
 */
export type ApprovalBroker = (request: ApprovalRequest) => Promise<boolean>;

/**
 * A folder-scoped agent session. Replaces the single global workspace path
 * for the folder-agent workflow, carrying the selected root, write mode,
 * permission mode, and the approval broker down through AsyncLocalStorage.
 */
export interface WorkspaceSession {
  rootDir: string;
  writeMode: WorkspaceWriteMode;
  permissionMode: PermissionMode;
  approvalBroker?: ApprovalBroker;
  /**
   * When set, file tools back up a file's prior content here before
   * overwriting or deleting it (filesystem-level undo; the non-git safety net).
   */
  onSnapshot?: (relPath: string, absPath: string) => Promise<void>;
}

/** Lightweight project map produced by indexing a workspace folder. */
export interface ProjectMap {
  rootDir: string;
  detectedStack: string[];
  fileCount: number;
  tree: string;
}
