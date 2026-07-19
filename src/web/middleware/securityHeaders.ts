import { Request, Response, NextFunction } from 'express';

/**
 * Baseline security headers. A Content-Security-Policy is deliberately omitted
 * for now because the views rely on inline scripts and CDN assets; add one once
 * those are vendored locally.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
