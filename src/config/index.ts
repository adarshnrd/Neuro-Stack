import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as dotenv from 'dotenv';
import { AppConfig } from '../types/index.js';
import { AUTH_TOKEN_TTL_SECONDS, LLM_TIMEOUT_MS } from './constants.js';

// Load environment variables
dotenv.config();

// `KEY=` in a .env file yields an empty string — treat it as unset.
const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const booleanFlag = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return undefined;
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  });

/**
 * Zod schema for validating environment variables
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('localhost'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Express "trust proxy" setting — required behind a reverse proxy / load
  // balancer so rate limiting and secure cookies see the real client.
  TRUST_PROXY: optionalString,

  LLM_MODEL: z.string().default('gemini-2.5-flash'),
  GOOGLE_API_KEY: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(LLM_TIMEOUT_MS),

  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  NVIDIA_API_KEY: optionalString,
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),
  NVIDIA_ULTRA_API_KEY: optionalString,
  NVIDIA_ULTRA_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),

  GITHUB_TOKEN: optionalString,
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  GITHUB_PRIVATE_KEY_PATH: optionalString,
  GITHUB_INSTALLATION_ID: optionalString,

  GITHUB_OWNER: z.string().default(''),
  GITHUB_REPO: z.string().default(''),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),

  WORKSPACE_PATH: z.string().default('./workspace'),
  CONTEXT_PATH: z.string().default('./context'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
  LOG_DIR: z.string().default('./logs'),

  SUPA_BASE_PROJECT_URL: z.string().url(),
  SUPA_BASE_DB_API_KEY: z.string().min(1),

  SESSION_SECRET: z.string().min(32).optional(),
  // Open sign-up. The very first user (the admin) can always register;
  // defaults to off in production so strangers can't create accounts.
  ALLOW_REGISTRATION: booleanFlag,

  FOLDER_AGENT_ROOT: optionalString,
});

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const details = envResult.error.errors.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  // Logger depends on config, so startup validation failures go to stderr directly.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}
const parsedEnv = envResult.data;
const isProduction = parsedEnv.NODE_ENV === 'production';

// Detect auth mode
const authMode = parsedEnv.GITHUB_TOKEN ? 'pat' : 'app';

if (!parsedEnv.GOOGLE_API_KEY && !parsedEnv.GROQ_API_KEY && !parsedEnv.NVIDIA_API_KEY && !parsedEnv.NVIDIA_ULTRA_API_KEY) {
  console.warn('Warning: no LLM API key is set (GOOGLE_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, NVIDIA_ULTRA_API_KEY). AI features will fail.');
}

// Session-token signing secret. In production a stable secret is mandatory;
// elsewhere we fall back to a random per-boot value, which keeps tokens
// unforgeable but logs everyone out on every restart.
if (!parsedEnv.SESSION_SECRET && isProduction) {
  console.error('SESSION_SECRET (min 32 chars) is required when NODE_ENV=production.');
  process.exit(1);
}
const sessionSecret = parsedEnv.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');
if (!parsedEnv.SESSION_SECRET) {
  console.warn('Warning: SESSION_SECRET is not set (min 32 chars). Using a random per-boot secret — all sessions are invalidated on restart.');
}

/**
 * The GitHub App private key may be supplied inline (GITHUB_PRIVATE_KEY, with
 * `\n` escapes) or as a path to the downloaded .pem file. Octokit needs the
 * PEM contents, not the path.
 */
function resolveGitHubPrivateKey(): string | undefined {
  if (parsedEnv.GITHUB_PRIVATE_KEY) return parsedEnv.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  if (!parsedEnv.GITHUB_PRIVATE_KEY_PATH) return undefined;
  try {
    return fs.readFileSync(path.resolve(parsedEnv.GITHUB_PRIVATE_KEY_PATH), 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: could not read GITHUB_PRIVATE_KEY_PATH (${message}). GitHub App auth will fail.`);
    return undefined;
  }
}

/** Maps TRUST_PROXY onto Express's accepted values: boolean, hop count, or subnet list. */
function resolveTrustProxy(): boolean | number | string {
  const raw = parsedEnv.TRUST_PROXY;
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export const config: AppConfig = {
  server: {
    port: parsedEnv.PORT,
    host: parsedEnv.HOST,
    nodeEnv: parsedEnv.NODE_ENV,
    isProduction,
    trustProxy: resolveTrustProxy(),
  },
  llm: {
    model: parsedEnv.LLM_MODEL,
    apiKey: parsedEnv.GOOGLE_API_KEY || '',
    timeoutMs: parsedEnv.LLM_TIMEOUT_MS,
  },
  github: {
    authMode,
    token: parsedEnv.GITHUB_TOKEN,
    appId: parsedEnv.GITHUB_APP_ID,
    privateKey: resolveGitHubPrivateKey(),
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
  },
  log: {
    level: parsedEnv.LOG_LEVEL,
    dir: parsedEnv.LOG_DIR,
  },
  database: {
    projectUrl: parsedEnv.SUPA_BASE_PROJECT_URL,
    apiKey: parsedEnv.SUPA_BASE_DB_API_KEY,
  },
  auth: {
    sessionSecret,
    tokenTtlSeconds: AUTH_TOKEN_TTL_SECONDS,
    allowRegistration: parsedEnv.ALLOW_REGISTRATION ?? !isProduction,
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
