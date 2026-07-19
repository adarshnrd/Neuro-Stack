import express from 'express';
import { registerUser, loginUser } from '../../services/authService.js';
import { findUserById } from '../../database/userRepository.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../logger/index.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();
const log = createChildLogger('authRoutes');

// Brute-force protection for credential endpoints
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, name: 'auth' });

function authCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `neurostack_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.auth.tokenTtlSeconds}${secure}`;
}

/**
 * POST /api/auth/register
 * Body: { username: string, password: string }
 */
router.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
      return;
    }

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
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

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
  res.setHeader('Set-Cookie', 'neurostack_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
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
