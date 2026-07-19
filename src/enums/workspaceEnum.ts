/** How the agent applies file changes within a workspace session. */
export enum WorkspaceWriteMode {
  /** Write changes straight into the selected folder (transactional). */
  DIRECT = 'direct',
  /** Stage changes into a changeset for human review (legacy review flow). */
  STAGED = 'staged',
}

/** How much autonomy the agent has over terminal/file operations. */
export enum PermissionMode {
  /** Self-directed: normal commands run without prompting; only high-risk
   *  commands pause for user approval. */
  AUTO = 'auto',
  /** Cautious: every command/operation pauses for user approval first. */
  MANUAL = 'manual',
}

/** Risk classification for a shell command. */
export enum CommandRisk {
  /** Ordinary dev command — safe to run under AUTO mode. */
  NORMAL = 'normal',
  /** Irreversible or system-affecting — always requires approval. */
  HIGH = 'high',
}
