import { getSupabaseClient } from './supabaseClient.js';
import { createChildLogger } from '../logger/index.js';
import { UserRole } from '../enums/authEnum.js';
import { AuthUser } from '../types/authTypes.js';

const log = createChildLogger('userRepository');

/**
 * Creates a new user row in the database.
 */
export async function createUser(
  username: string,
  passwordHash: string,
  role: UserRole = UserRole.USER,
): Promise<AuthUser> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .insert({ username, password_hash: passwordHash, role })
    .select('id, username, role, created_at, updated_at')
    .single();

  if (error) {
    log.error('Failed to create user', { source: 'userRepository#createUser', error: error.message });
    throw new Error(`Failed to create user: ${error.message}`);
  }

  log.info('User created', { source: 'userRepository#createUser', userId: data.id, username });

  return {
    id: data.id,
    username: data.username,
    role: data.role as UserRole,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Finds a user by username. Returns null if not found.
 */
export async function findUserByUsername(username: string): Promise<(AuthUser & { passwordHash: string }) | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .select('id, username, password_hash, role, created_at, updated_at')
    .eq('username', username)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Row not found
    log.error('Failed to find user', { source: 'userRepository#findUserByUsername', error: error.message });
    throw new Error(`Failed to find user: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    username: data.username,
    passwordHash: data.password_hash,
    role: data.role as UserRole,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Finds a user by ID. Returns null if not found.
 */
export async function findUserById(userId: string): Promise<AuthUser | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('users')
    .select('id, username, role, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    log.error('Failed to find user by ID', { source: 'userRepository#findUserById', error: error.message });
    throw new Error(`Failed to find user: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    username: data.username,
    role: data.role as UserRole,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Returns the total number of users in the database.
 * Used to determine if the first registering user should become admin.
 */
export async function getUserCount(): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true });

  if (error) {
    log.error('Failed to count users', { source: 'userRepository#getUserCount', error: error.message });
    throw new Error(`Failed to count users: ${error.message}`);
  }

  return count ?? 0;
}
