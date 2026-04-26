import express from 'express';
import { registerUser, loginUser, validateToken } from '../../services/authService.js';
import { createChildLogger } from '../../logger/index.js';

const router = express.Router();
const log = createChildLogger('authRoutes');

/**
 * POST /api/auth/register
 * Body: { username: string, password: string }
 */
router.post('/api/auth/register', async (req, res) => {
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
      res.setHeader('Set-Cookie', `jarvis_token=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
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
router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required.' });
      return;
    }

    const result = await loginUser(username, password);

    if (result.success && result.token) {
      res.setHeader('Set-Cookie', `jarvis_token=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
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
  res.setHeader('Set-Cookie', 'jarvis_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true, message: 'Logged out.' });
});

/**
 * GET /api/auth/me
 * Returns the current authenticated user info.
 */
router.get('/api/auth/me', async (req, res) => {
  try {
    const token =
      (req.headers.cookie?.split(';').find((c) => c.trim().startsWith('jarvis_token='))
        ?.split('=')[1]?.trim()) ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const result = await validateToken(token);
    if (!result.success) {
      res.status(401).json(result);
      return;
    }

    res.json({ success: true, user: result.user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Me endpoint error', { source: 'authRoutes#me', error: message });
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

export default router;
