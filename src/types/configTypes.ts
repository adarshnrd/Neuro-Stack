export interface ServerConfig {
  port: number;
  host: string;
}

export interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
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
  maxFileSizeKB: number;
}

export interface SessionConfig {
  activeWindowHours: number;
  retentionDays: number;
  autoPurgeDays: number;
}

export interface LogConfig {
  level: string;
}

export interface DatabaseConfig {
  projectUrl: string;
  apiKey: string;
}

export interface AuthConfig {
  sessionSecret: string;
  tokenTtlSeconds: number;
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
  session: SessionConfig;
  log: LogConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  llmProviders: LLMProvidersConfig;
  folderAgent: FolderAgentConfig;
}
