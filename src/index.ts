import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import { config } from './config/index.js';
import { createChildLogger } from './logger/index.js';
import router from './web/routes/index.js';
import {
  commandRegistry,
  AgentHandler,
  CreatePrHandler,
  PrReviewHandler,
  PrApproveHandler,
  MergePrHandler,
} from './commands/index.js';
import { changeSetService } from './services/changeSetService.js';
import { authMiddleware } from './web/middleware/authMiddleware.js';
import { securityHeaders } from './web/middleware/securityHeaders.js';
import { checkSupabaseConnection } from './database/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createChildLogger('bootstrap');
const SHUTDOWN_GRACE_MS = 10_000;

async function bootstrap() {
  log.info('Starting Project NeuroStack...', { source: 'index#bootstrap', env: config.server.nodeEnv });

  // Verify Supabase connection
  const dbOk = await checkSupabaseConnection();
  if (dbOk) {
    log.info('Supabase connection verified', { source: 'index#bootstrap' });
  } else {
    log.warn('Supabase connection failed — database features may not work', { source: 'index#bootstrap' });
  }

  // Load pending changesets from disk
  log.debug('Loading changesets from disk', { source: 'index#bootstrap' });
  await changeSetService.loadFromDisk();
  
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy this makes req.ip (rate limiting) and req.secure reflect the real client
  app.set('trust proxy', config.server.trustProxy);

  // Register command handlers
  log.debug('Registering command handlers', { source: 'index#bootstrap' });
  commandRegistry.register(new AgentHandler());
  commandRegistry.register(new CreatePrHandler());
  commandRegistry.register(new PrReviewHandler());
  commandRegistry.register(new PrApproveHandler());
  commandRegistry.register(new MergePrHandler());

  // Handlebars view engine
  log.debug('Configuring template engine', { source: 'index#bootstrap' });
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: false,
  }));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, 'web', 'views'));

  // Middleware
  log.debug('Mounting middleware', { source: 'index#bootstrap' });
  app.use(securityHeaders);
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.server.isProduction ? '1h' : 0 }));
  app.use(express.json({ limit: '256kb' }));

  // Auth middleware — gates all routes except public paths
  app.use(authMiddleware);

  // Routes (view + API)
  app.use(router);

  // 404 — JSON for API paths, redirect for views
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ type: 'error', content: 'Not found.' });
    } else {
      res.redirect('/app');
    }
  });

  // Central error handler — last resort so no error leaks a stack to clients
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error('Unhandled request error', {
      source: 'index#errorHandler',
      path: req.path,
      error: err.message,
      stack: err.stack,
    });
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ type: 'error', content: 'Internal server error.' });
    } else {
      res.status(500).send('Internal server error.');
    }
  });

  const server = app.listen(config.server.port, config.server.host, () => {
    log.info(`Server running on http://${config.server.host}:${config.server.port}`, { source: 'index#bootstrap' });
  });

  registerShutdownHandlers(server);
}

/**
 * Stops accepting connections on SIGTERM/SIGINT and lets in-flight requests
 * finish. Long-lived SSE streams (agent runs) get a grace period, then the
 * process exits regardless so orchestrators aren't left waiting.
 */
function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutdown signal received — closing server', { source: 'index#shutdown', signal });

    server.close(() => {
      log.info('HTTP server closed', { source: 'index#shutdown' });
      process.exit(0);
    });
    server.closeIdleConnections();

    setTimeout(() => {
      log.warn('Forcing shutdown after grace period', { source: 'index#shutdown', graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log.error('Unhandled promise rejection', { source: 'index#unhandledRejection', error: message, stack });
});

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception — exiting', { source: 'index#uncaughtException', error: error.message, stack: error.stack });
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log.error('Failed to bootstrap app', { source: 'index#bootstrap', error: message, stack });
  process.exit(1);
});
