import { BaseAppError } from './baseError.js';

export class GitOperationError extends BaseAppError {
  constructor(operation: string, detail: string, context?: Record<string, unknown>) {
    super(`Git ${operation} failed: ${detail}`, 'GIT_OPERATION_ERROR', 500, true, context);
  }
}

export class GitHubApiError extends BaseAppError {
  constructor(operation: string, detail: string, statusCode: number = 500, context?: Record<string, unknown>) {
    super(`GitHub API ${operation} failed: ${detail}`, 'GITHUB_API_ERROR', statusCode, true, context);
  }
}
