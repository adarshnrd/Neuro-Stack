import { BaseAppError } from './baseError.js';

export class CommandError extends BaseAppError {
  constructor(command: string, detail: string, context?: Record<string, unknown>) {
    super(`Command ${command} failed: ${detail}`, 'COMMAND_ERROR', 400, true, context);
  }
}
