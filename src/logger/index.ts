import path from 'path';
import winston from 'winston';
import { config } from '../config/index.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_COUNT = 5;

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

// Production emits structured JSON (for log shippers); development keeps the
// readable line format, with colours on the console only so files stay clean.
const consoleFormat = config.server.isProduction ? json() : combine(colorize(), logFormat);
const fileFormat = config.server.isProduction ? json() : logFormat;

function rotatingFile(filename: string, level?: string): winston.transports.FileTransportInstance {
  return new winston.transports.File({
    filename: path.join(config.log.dir, filename),
    level,
    format: fileFormat,
    maxsize: LOG_FILE_MAX_BYTES,
    maxFiles: LOG_FILE_MAX_COUNT,
    tailable: true,
  });
}

export const logger = winston.createLogger({
  level: config.log.level,
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true })),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    rotatingFile('error.log', 'error'),
    rotatingFile('combined.log'),
    rotatingFile('query-trace.log', 'debug'),
  ],
});

export function createChildLogger(module: string): winston.Logger {
  return logger.child({ module });
}

export function withQueryId(baseLogger: winston.Logger, queryId: string): winston.Logger {
  return baseLogger.child({ queryId });
}
