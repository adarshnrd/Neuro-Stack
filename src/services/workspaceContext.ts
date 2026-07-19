import { AsyncLocalStorage } from 'async_hooks';
import { WorkspaceSession } from '../types/workspaceTypes.js';

/**
 * Carries the active folder-agent session (root dir, write mode, permission
 * mode, approval broker) through the async call tree — the same pattern as
 * changeSetContext. Tools read this to scope file/shell operations to the
 * selected folder instead of the global workspace path.
 */
export const workspaceContext = new AsyncLocalStorage<WorkspaceSession>();

/** The active session, if a folder-agent run is in progress. */
export function getWorkspaceSession(): WorkspaceSession | undefined {
  return workspaceContext.getStore();
}
