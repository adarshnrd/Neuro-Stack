import { z } from 'zod';
import { ValidationError } from '../errors/validationError.js';

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMsg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new ValidationError('input', errorMsg);
  }
  return result.data;
}
