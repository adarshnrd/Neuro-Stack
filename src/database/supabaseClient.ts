import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('supabaseClient');

let client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client instance.
 * Initialised lazily on first call using validated config values.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    log.info('Initialising Supabase client', {
      source: 'supabaseClient#getSupabaseClient',
      projectUrl: config.database.projectUrl,
    });
    client = createClient(config.database.projectUrl, config.database.apiKey);
  }
  return client;
}

/**
 * Lightweight health check — attempts a simple query against the users table.
 * Returns true if the connection is valid, false otherwise.
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      log.error('Supabase connection check failed', {
        source: 'supabaseClient#checkSupabaseConnection',
        error: error.message,
      });
      return false;
    }
    log.info('Supabase connection verified', { source: 'supabaseClient#checkSupabaseConnection' });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Supabase connection check threw', {
      source: 'supabaseClient#checkSupabaseConnection',
      error: message,
    });
    return false;
  }
}
