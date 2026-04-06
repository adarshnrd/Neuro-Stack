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

export interface AppConfig {
  server: ServerConfig;
  llm: LLMConfig;
  github: GitHubConfig;
  workspace: WorkspaceConfig;
  context: ContextConfig;
  session: SessionConfig;
  log: LogConfig;
}
