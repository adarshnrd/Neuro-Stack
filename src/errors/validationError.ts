import { BaseAppError } from './baseError.js';

export class ValidationError extends BaseAppError {
  constructor(field: string, detail: string) {
    super(`Validation failed for "${field}": ${detail}`, 'VALIDATION_ERROR', 400);
  }
}
