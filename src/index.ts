import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import { config } from './config/index.js';
import { createChildLogger } from './logger/index.js';
import router from './web/routes/index.js';
import { commandRegistry, NewSessionHandler, AgentHandler } from './commands/index.js';
import { changeSetService } from './services/changeSetService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createChildLogger('bootstrap');

async function bootstrap() {
  log.info('Starting Project Jarvis...', { source: 'index#bootstrap', env: config.server.host });

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

  // Routes (view + API)
  app.use(router);

  app.listen(config.server.port, () => {
    log.info(`Server running on http://${config.server.host}:${config.server.port}`, { source: 'index#bootstrap' });
  });
}

bootstrap().catch((error: any) => {
  log.error('Failed to bootstrap app', { source: 'index#bootstrap', error: error.message, stack: error.stack });
  process.exit(1);
});
