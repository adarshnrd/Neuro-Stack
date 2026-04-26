import bcrypt from 'bcrypt';
import { createUser, findUserByUsername, findUserById, getUserCount } from '../database/userRepository.js';
import { UserRole } from '../enums/authEnum.js';
import { AuthResult } from '../types/authTypes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('authService');
const SALT_ROUNDS = 12;

/**
 * Registers a new user. The very first user to register becomes admin.
 */
export async function registerUser(username: string, password: string): Promise<AuthResult> {
  log.info('Registration attempt', { source: 'authService#registerUser', username });

  try {
    // Check if user already exists
    const existing = await findUserByUsername(username);
    if (existing) {
      log.warn('Registration failed — username taken', { source: 'authService#registerUser', username });
      return { success: false, message: 'Username already exists.' };
    }

    // Determine role — first user becomes admin
    const userCount = await getUserCount();
    const role = userCount === 0 ? UserRole.ADMIN : UserRole.USER;

    log.info('Assigning role to new user', { source: 'authService#registerUser', username, role, userCount });

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(username, passwordHash, role);

    log.info('User registered successfully', { source: 'authService#registerUser', userId: user.id, role });

    return {
      success: true,
      message: 'Registration successful.',
      user,
      token: user.id, // Simple token = userId (sufficient for cookie-based auth)
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Registration error', { source: 'authService#registerUser', error: message });
    return { success: false, message: `Registration failed: ${message}` };
  }
}

/**
 * Authenticates a user by username and password.
 */
export async function loginUser(username: string, password: string): Promise<AuthResult> {
  log.info('Login attempt', { source: 'authService#loginUser', username });

  try {
    const user = await findUserByUsername(username);
    if (!user) {
      log.warn('Login failed — user not found', { source: 'authService#loginUser', username });
      return { success: false, message: 'Invalid username or password.' };
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      log.warn('Login failed — password mismatch', { source: 'authService#loginUser', username });
      return { success: false, message: 'Invalid username or password.' };
    }

    log.info('Login successful', { source: 'authService#loginUser', userId: user.id });

    return {
      success: true,
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      token: user.id,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Login error', { source: 'authService#loginUser', error: message });
    return { success: false, message: `Login failed: ${message}` };
  }
}

/**
 * Validates a token (userId) and returns the user.
 */
export async function validateToken(token: string): Promise<AuthResult> {
  try {
    const user = await findUserById(token);
    if (!user) {
      return { success: false, message: 'Invalid token.' };
    }
    return { success: true, message: 'Valid.', user };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Token validation error', { source: 'authService#validateToken', error: message });
    return { success: false, message: 'Token validation failed.' };
  }
}
