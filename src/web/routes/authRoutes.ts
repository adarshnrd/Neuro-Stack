import express from 'express';
import { z } from 'zod';
import { registerUser, loginUser, isRegistrationOpen } from '../../services/authService.js';
import { findUserById } from '../../database/userRepository.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../logger/index.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const log = createChildLogger('authRoutes');

// Brute-force protection for credential endpoints
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'auth' });

// bcrypt only uses the first 72 bytes of a password, so cap the length there.
const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(32, 'Username must be at most 32 characters.')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, dot, dash, and underscore.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must be at most 72 characters.'),
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(72),
});

function authCookie(token: string, maxAgeSeconds: number = config.auth.tokenTtlSeconds): string {
  const secure = config.server.isProduction ? '; Secure' : '';
  return `neurostack_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

/**
 * POST /api/auth/register
 * Body: { username: string, password: string }
 */
router.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? 'Invalid input.' });
      return;
    }

    if (!(await isRegistrationOpen())) {
      res.status(403).json({ success: false, message: 'Registration is disabled. Ask an administrator for an account.' });
      return;
    }

    const { username, password } = parsed.data;
    const result = await registerUser(username, password);

    if (result.success && result.token) {
      res.setHeader('Set-Cookie', authCookie(result.token));
    }

    const status = result.success ? 201 : 409;
    res.status(status).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Registration endpoint error', { source: 'authRoutes#register', error: message });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 */
router.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const { username, password } = parsed.data;
    const result = await loginUser(username, password);

    if (result.success && result.token) {
      res.setHeader('Set-Cookie', authCookie(result.token));
    }

    const status = result.success ? 200 : 401;
    res.status(status).json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Login endpoint error', { source: 'authRoutes#login', error: message });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', authCookie('', 0));
  res.json({ success: true, message: 'Logged out.' });
});

/**
 * GET /api/auth/me
 * Returns the current authenticated user info.
 * authMiddleware has already validated the token and set req.userId.
 */
router.get('/api/auth/me', async (req, res) => {
  try {
    if (!req.userId) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const user = await findUserById(req.userId);
    if (!user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    res.json({ success: true, user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Me endpoint error', { source: 'authRoutes#me', error: message });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
