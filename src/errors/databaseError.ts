import { BaseAppError } from './baseError.js';

/** The connected database is missing a migration this feature needs. */
export class DatabaseSchemaError extends BaseAppError {
  constructor(migrationFile: string, context?: Record<string, unknown>) {
    super(
      `Database schema is out of date: run src/database/migrations/${migrationFile} in the Supabase SQL Editor.`,
      'DATABASE_SCHEMA_OUTDATED',
      503,
      true,
      context,
    );
  }
}
