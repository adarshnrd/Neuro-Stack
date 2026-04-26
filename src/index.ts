import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import { config } from './config/index.js';
import { createChildLogger } from './logger/index.js';
import router from './web/routes/index.js';
import { commandRegistry, NewSessionHandler, AgentHandler } from './commands/index.js';
import { changeSetService } from './services/changeSetService.js';
import { authMiddleware } from './web/middleware/authMiddleware.js';
import { checkSupabaseConnection } from './database/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createChildLogger('bootstrap');

async function bootstrap() {
  log.info('Starting Project Jarvis...', { source: 'index#bootstrap', env: config.server.host });

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

  // Register command handlers
  log.debug('Registering command handlers', { source: 'index#bootstrap' });
  commandRegistry.register(new NewSessionHandler());
  commandRegistry.register(new AgentHandler());

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
  app.use(express.static('public'));
  app.use(express.json());

  // Auth middleware — gates all routes except public paths
  app.use(authMiddleware);

  // Routes (view + API)
  app.use(router);

  app.listen(config.server.port, () => {
    log.info(`Server running on http://${config.server.host}:${config.server.port}`, { source: 'index#bootstrap' });
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  log.error('Failed to bootstrap app', { source: 'index#bootstrap', error: message, stack });
  process.exit(1);
});
