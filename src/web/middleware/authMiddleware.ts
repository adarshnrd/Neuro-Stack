import { Request, Response, NextFunction } from 'express';
import { validateToken } from '../../services/authService.js';
import { getCookie } from '../../utils/cookieUtil.js';

// Extend Express Request to carry auth state
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
    }
  }
}

/** Paths that do not require authentication (exact match) */
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/health',
  '/signin',
  '/signup',
  '/',
]);

/**
 * Express middleware that gates API and view routes behind authentication.
 * Checks for a `neurostack_token` cookie (or `Authorization` header) on every
 * request, except for public paths and static assets.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Always allow static assets
  if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images')) {
    next();
    return;
  }

  // Always allow public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Extract token from cookie or Authorization header
  const token = getCookie(req, 'neurostack_token') || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    // For API routes → 401 JSON, for view routes → redirect to signin
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ type: 'error', content: 'Authentication required.' });
    } else {
      res.redirect('/signin');
    }
    return;
  }

  const result = await validateToken(token);
  if (!result.success || !result.user) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ type: 'error', content: 'Invalid or expired token.' });
    } else {
      res.redirect('/signin');
    }
    return;
  }

  // Attach user info to request
  req.userId = result.user.id;
  req.userRole = result.user.role;
  next();
}
