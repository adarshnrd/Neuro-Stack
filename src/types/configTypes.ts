export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  /** Express "trust proxy" value (false, true, hop count, or subnet list). */
  trustProxy: boolean | number | string;
}

export interface LLMConfig {
  model: string;
  apiKey: string;
  /** Per-call timeout for LLM requests, in milliseconds. */
  timeoutMs: number;
}

export interface GitHubConfig {
  authMode: 'pat' | 'app';
  token?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface WorkspaceConfig {
  path: string;
}

export interface ContextConfig {
  basePath: string;
}

export interface LogConfig {
  level: string;
  dir: string;
}

export interface DatabaseConfig {
  projectUrl: string;
  apiKey: string;
}

export interface AuthConfig {
  sessionSecret: string;
  tokenTtlSeconds: number;
  /** Whether new accounts may self-register (the first/admin account always can). */
  allowRegistration: boolean;
}

export interface FolderAgentConfig {
  /** Base directory the web folder-picker is allowed to browse within. */
  browseRoot: string;
}

export interface ProviderCredentials {
  apiKey: string;
  model: string;
}

/** Optional additional model providers used by role-based routing. */
export interface LLMProvidersConfig {
  groq?: ProviderCredentials;
  nvidia?: ProviderCredentials;
  nvidiaUltra?: ProviderCredentials;
}

export interface AppConfig {
  server: ServerConfig;
  llm: LLMConfig;
  github: GitHubConfig;
  workspace: WorkspaceConfig;
  context: ContextConfig;
  log: LogConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  llmProviders: LLMProvidersConfig;
  folderAgent: FolderAgentConfig;
}
