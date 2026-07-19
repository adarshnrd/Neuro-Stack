import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../../logger/index.js';

const log = createChildLogger('rateLimiter');

interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
}

/**
 * Minimal fixed-window in-memory rate limiter keyed by client IP.
 * Suitable for a single-process deployment; swap for a shared store
 * (e.g. Redis) if the app is ever scaled horizontally.
 */
export function createRateLimiter({ windowMs, max, name }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Drop expired windows so the map doesn't grow unbounded
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      log.warn('Rate limit exceeded', { source: 'rateLimiter', name, ip: key });
      res.status(429).json({ type: 'error', content: 'Too many requests. Please slow down.' });
      return;
    }
    next();
  };
}
