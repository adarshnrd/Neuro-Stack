import { z } from 'zod';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import * as dotenv from 'dotenv';
import { AppConfig } from '../types/index.js';
import { SESSION_ACTIVE_WINDOW_HOURS, SESSION_RETENTION_DAYS, SESSION_AUTO_PURGE_DAYS, CONTEXT_MAX_FILE_SIZE_KB, ARCHIVE_RETENTION_DAYS, AUTH_TOKEN_TTL_SECONDS } from './constants.js';

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

  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),
  NVIDIA_ULTRA_API_KEY: z.string().optional(),
  NVIDIA_ULTRA_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),

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

  SESSION_SECRET: z.string().min(32).optional(),

  FOLDER_AGENT_ROOT: z.string().optional(),
});

const parsedEnv = envSchema.parse(process.env);

// Detect auth mode
const authMode = parsedEnv.GITHUB_TOKEN ? 'pat' : 'app';

if (parsedEnv.LLM_PROVIDER === 'gemini' && !parsedEnv.GOOGLE_API_KEY) {
  console.warn('Warning: GOOGLE_API_KEY is not set. Gemini operations will fail.');
}

// Session-token signing secret. Without a configured secret we fall back to a
// random per-boot value, which keeps tokens unforgeable but logs everyone out
// on every restart.
const sessionSecret = parsedEnv.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');
if (!parsedEnv.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET is not set (min 32 chars). Using a random per-boot secret — all sessions are invalidated on restart.');
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
  auth: {
    sessionSecret,
    tokenTtlSeconds: AUTH_TOKEN_TTL_SECONDS,
  },
  llmProviders: {
    groq: parsedEnv.GROQ_API_KEY
      ? { apiKey: parsedEnv.GROQ_API_KEY, model: parsedEnv.GROQ_MODEL }
      : undefined,
    nvidia: parsedEnv.NVIDIA_API_KEY
      ? { apiKey: parsedEnv.NVIDIA_API_KEY, model: parsedEnv.NVIDIA_MODEL }
      : undefined,
    nvidiaUltra: parsedEnv.NVIDIA_ULTRA_API_KEY
      ? { apiKey: parsedEnv.NVIDIA_ULTRA_API_KEY, model: parsedEnv.NVIDIA_ULTRA_MODEL }
      : undefined,
  },
  folderAgent: {
    browseRoot: parsedEnv.FOLDER_AGENT_ROOT ? path.resolve(parsedEnv.FOLDER_AGENT_ROOT) : os.homedir(),
  },
};
