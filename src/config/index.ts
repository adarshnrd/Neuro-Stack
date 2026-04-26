import { z } from 'zod';
import * as dotenv from 'dotenv';
import { AppConfig } from '../types/index.js';
import { SESSION_ACTIVE_WINDOW_HOURS, SESSION_RETENTION_DAYS, SESSION_AUTO_PURGE_DAYS, CONTEXT_MAX_FILE_SIZE_KB, ARCHIVE_RETENTION_DAYS } from './constants.js';

// Load environment variables
dotenv.config();

/**
 * Zod schema for validating environment variables
 */
const envSchema = z.object({
  PORT: z.string().transform(Number).default('3000'),
  NODE_ENV: z.string().default('development'),

  LLM_PROVIDER: z.string().default('gemini'),
  LLM_MODEL: z.string().default('gemini-2.5-flash'),
  GOOGLE_API_KEY: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),

  GITHUB_OWNER: z.string().default(''),
  GITHUB_REPO: z.string().default(''),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),

  WORKSPACE_PATH: z.string().default('./workspace'),
  CONTEXT_PATH: z.string().default('./context'),

  SESSION_ACTIVE_WINDOW_HOURS: z.string().transform(Number).default(SESSION_ACTIVE_WINDOW_HOURS.toString()),
  SESSION_RETENTION_DAYS: z.string().transform(Number).default(SESSION_RETENTION_DAYS.toString()),
  SESSION_AUTO_PURGE_DAYS: z.string().transform(Number).default(SESSION_AUTO_PURGE_DAYS.toString()),

  CONTEXT_MAX_FILE_SIZE_KB: z.string().transform(Number).default(CONTEXT_MAX_FILE_SIZE_KB.toString()),
  ARCHIVE_RETENTION_DAYS: z.string().transform(Number).default(ARCHIVE_RETENTION_DAYS.toString()),

  LOG_LEVEL: z.string().default('info'),

  SUPA_BASE_PROJECT_URL: z.string().min(1),
  SUPA_BASE_DB_API_KEY: z.string().min(1),
});

const parsedEnv = envSchema.parse(process.env);

// Detect auth mode
const authMode = parsedEnv.GITHUB_TOKEN ? 'pat' : 'app';

if (authMode === 'pat' && !parsedEnv.GITHUB_TOKEN) {
  console.warn('Warning: GITHUB_TOKEN is not set. Git operations may fail.');
}

if (parsedEnv.LLM_PROVIDER === 'gemini' && !parsedEnv.GOOGLE_API_KEY) {
  console.warn('Warning: GOOGLE_API_KEY is not set. Gemini operations will fail.');
}

export const config: AppConfig = {
  server: {
    port: parsedEnv.PORT,
    host: 'localhost',
  },
  llm: {
    provider: parsedEnv.LLM_PROVIDER,
    model: parsedEnv.LLM_MODEL,
    apiKey: parsedEnv.GOOGLE_API_KEY || '',
  },
  github: {
    authMode,
    token: parsedEnv.GITHUB_TOKEN,
    appId: parsedEnv.GITHUB_APP_ID,
    privateKey: parsedEnv.GITHUB_PRIVATE_KEY_PATH,
    installationId: parsedEnv.GITHUB_INSTALLATION_ID,
    owner: parsedEnv.GITHUB_OWNER,
    repo: parsedEnv.GITHUB_REPO,
    defaultBranch: parsedEnv.GITHUB_DEFAULT_BRANCH,
  },
  workspace: {
    path: parsedEnv.WORKSPACE_PATH,
  },
  context: {
    basePath: parsedEnv.CONTEXT_PATH,
    maxFileSizeKB: parsedEnv.CONTEXT_MAX_FILE_SIZE_KB,
  },
  session: {
    activeWindowHours: parsedEnv.SESSION_ACTIVE_WINDOW_HOURS,
    retentionDays: parsedEnv.SESSION_RETENTION_DAYS,
    autoPurgeDays: parsedEnv.SESSION_AUTO_PURGE_DAYS,
  },
  log: {
    level: parsedEnv.LOG_LEVEL,
  },
  database: {
    projectUrl: parsedEnv.SUPA_BASE_PROJECT_URL,
    apiKey: parsedEnv.SUPA_BASE_DB_API_KEY,
  },
};
