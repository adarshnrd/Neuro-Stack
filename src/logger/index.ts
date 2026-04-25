import winston from 'winston';
import { config } from '../config/index.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, module, source, queryId, ...meta }) => {
  const parts = [`${timestamp} [${level}]`];
  if (queryId) parts.push(`[${queryId}]`);
  if (module) parts.push(`[${module}]`);
  if (source) parts.push(`(${source})`);
  parts.push(`: ${stack || message}`);
  
  if (Object.keys(meta).length) {
    parts.push(` ${JSON.stringify(meta)}`);
  }
  return parts.join(' ');
});

export const logger = winston.createLogger({
  level: config.log.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    config.server.host === 'localhost' ? colorize() : json(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.File({ filename: 'logs/query-trace.log', level: 'debug' }),
  ],
});

export function createChildLogger(module: string): winston.Logger {
  return logger.child({ module });
}

export function withQueryId(baseLogger: winston.Logger, queryId: string): winston.Logger {
  return baseLogger.child({ queryId });
}
