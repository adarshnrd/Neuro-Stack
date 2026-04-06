import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { engine } from 'express-handlebars';
import { config } from './config/index.js';
import { logger } from './logger/index.js';
import router from './web/routes/index.js';
import { commandRegistry, NewSessionHandler, parseUserInput } from './commands/index.js';
import { buildGraph } from './graph/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  logger.info('Starting Project Jarvis...');
  
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Register handlers
  commandRegistry.register(new NewSessionHandler());

  // Basic graph build test
  const graph = buildGraph();

  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: false, // Set to false since layouts directory is empty for now
  }));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, 'web', 'views'));

  app.use(express.static('public'));
  app.use(express.json());

  // Use combined routes
  app.use(router);

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected');

    ws.on('message', async (message: string) => {
      try {
        const text = message.toString();
        logger.info(`Received message: ${text}`);
        
        const parsedCommand = parseUserInput(text);
        
        if (parsedCommand.isCommand) {
          ws.send(JSON.stringify({
            type: 'system',
            content: `Command received: ${parsedCommand.command}`
          }));
        } else {
          // Dummy response
          ws.send(JSON.stringify({
            type: 'ai',
            content: `Echo: ${text}`
          }));
        }
      } catch (error: any) {
        logger.error('WebSocket message error', { error });
      }
    });
  });

  server.listen(config.server.port, () => {
    logger.info(`Server running on http://${config.server.host}:${config.server.port}`);
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to bootstrap app', { error });
  process.exit(1);
});
