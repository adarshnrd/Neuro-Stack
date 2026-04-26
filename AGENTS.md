# AGENTS.md — Project Jarvis Code Standards

## Project Overview

Project Jarvis is an **AI-powered Git workflow assistant** built on **Express 4**, **TypeScript (strict)**, **LangChain**, **LangGraph**, and **Google Gemini**. It accepts natural language and structured `@commands` via a chat UI (Handlebars + WebSocket), orchestrates multi-step workflows through a stateful LangGraph engine, manages Git operations via `simple-git` and GitHub via `Octokit`, and persists all context and memory as structured Markdown files (no database).

---

## Project Structure

```
src/
  commands/             # Command parser, registry, and handler classes
    handlers/           # Individual @command handler implementations (AgentHandler, NewSessionHandler, etc.)
  config/               # Zod-validated environment config + numeric defaults
  constants/            # Domain-specific constant modules (chat, command)
  enums/                # TypeScript enums (PascalCase names, no suffix required)
  errors/               # Custom error class hierarchy extending BaseAppError
  graph/                # LangGraph state definition, workflow compilation, and graph nodes
    nodes/              # Individual LangGraph node implementations
  llm/                  # LLM provider abstraction layer
    providers/          # Concrete provider implementations (Gemini, future OpenAI)
  logger/               # Winston structured logger with child logger factory
  memory/               # Markdown-based context persistence (loader, writer, session, archive, prompt)
  services/             # Business logic services (chat, context, git, github, session)
  tools/                # LangChain tool wrappers (file, git, github operations)
  types/                # TypeScript interfaces grouped by domain (config, command, session)
  utils/                # Pure utility functions (file, date, string, validation)
  web/                  # Express server layer
    routes/             # API routes (apiRoutes) and view routes (viewRoutes)
    views/              # Handlebars templates (.hbs)
context/                # Markdown-based persistence (rules, commands, agents, sessions, memory, archive)
public/                 # Static web assets (CSS, JS, images)
logs/                   # Runtime log files (error, combined, query-trace)
workspace/              # Cloned repository working directory
plans/                  # Development plans and documentation
```

---

## TypeScript Configuration

- **Target:** ES2022, **Module:** NodeNext, **ModuleResolution:** NodeNext, **Strict mode:** enabled
- **Output:** `./dist` directory, **Root:** `./src`
- **ESM project:** `"type": "module"` in `package.json` — all imports MUST include `.js` extension
- **No path aliases** — use relative imports with `.js` extension throughout
- **Node engines:** `>=18.x`
- **`skipLibCheck`:** enabled
- **`forceConsistentCasingInFileNames`:** enabled
- **`resolveJsonModule`:** enabled, **`allowJs`:** enabled

### Critical ESM Rule

Because the project uses native ESM (`"type": "module"`), **every local import MUST end with `.js`**:

```typescript
// CORRECT
import { config } from '../config/index.js';
import { createChildLogger } from '../logger/index.js';

// WRONG — will fail at runtime
import { config } from '../config/index';
import { config } from '../config';
```

---

## Formatting

All code MUST conform to these conventions (observed across the entire codebase):

| Setting         | Value          |
| --------------- | -------------- |
| Semicolons      | always         |
| Quotes          | single (`'`)   |
| Trailing commas | `es5`          |
| Print width     | ~120 characters |
| Tab width       | 2 spaces       |
| Arrow parens    | always         |

---

## Type Safety

TypeScript strict mode is enabled. These rules are enforced:

| Rule                             | Level   | Notes                                                        |
| -------------------------------- | ------- | ------------------------------------------------------------ |
| Avoid `any`                      | strong  | Use `unknown`, generics, or proper types wherever possible   |
| Unused variables                 | error   | Enforced by `strict` mode                                    |
| Catch variable typing            | pattern | Use `error: unknown` in new code, narrow with `instanceof Error` |
| Non-null assertions (`!`)        | avoid   | Prefer explicit null checks or optional chaining             |

When generating or reviewing code, ensure **zero** new TypeScript errors. Fix warnings when touching a file.

### Catch Variable Pattern

The project's preferred error-handling style for catch blocks uses **`unknown`** with proper narrowing:

```typescript
// CORRECT — new code pattern (see agentHandler.ts)
catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack   = error instanceof Error ? error.stack   : undefined;
  log.error('Descriptive message', { source: 'module#method', error: message, stack });
}

// ACCEPTABLE — legacy pattern used in some files
catch (error: any) {
  log.error('Descriptive message', { source: 'module#method', error: error.message, stack: error.stack });
}
```

**New code MUST use `error: unknown`** with `instanceof Error` narrowing. Do not introduce new `catch (error: any)` blocks.

---

## Naming Conventions

| Element                | Convention                           | Example                                              |
| ---------------------- | ------------------------------------ | ---------------------------------------------------- |
| Classes                | PascalCase                           | `GitService`, `AgentHandler`, `ContextLoader`        |
| Interfaces             | PascalCase (no prefix for data shapes) | `CommandArgs`, `AppConfig`, `Session`              |
| Type aliases           | PascalCase (no prefix)               | `StateType`, `ParsedCommand`, `CommandResult`        |
| Variables / Parameters | camelCase                            | `sessionId`, `queryId`, `branchName`                 |
| Private members        | no underscore (dominant style)       | `private git`, `private loader`, `private octokit`   |
| Readonly class fields  | `private readonly` (when applicable) | `private readonly contextService: ContextService`    |
| Exported constants     | SCREAMING_SNAKE_CASE                 | `SYSTEM_PROMPT`, `AGENT_USAGE_GUIDE`, `SESSION_ACTIVE_WINDOW_HOURS` |
| Enum names             | PascalCase (no suffix required)      | `CommandName`, `MergeMethod`, `SessionStatus`        |
| Enum members           | SCREAMING_SNAKE_CASE                 | `AGENT`, `NEW_SESSION`, `MERGE`, `OPEN`              |
| Files                  | camelCase `.ts`                      | `chatService.ts`, `gitTools.ts`, `commandEnum.ts`    |
| Folders                | camelCase                            | `commands/`, `services/`, `enums/`, `types/`, `utils/` |

**Rule:** All folders and files in this project use **camelCase** uniformly. New files and folders MUST follow this convention.

### Descriptive Identifier Requirement

All identifiers — variables, parameters, functions, classes, properties, and enum members — **MUST use clear, intent-driven names** that reflect the purpose and context of the logic. Vague, abbreviated, or non-descriptive names are strictly prohibited.

```typescript
// WRONG — vague, meaningless identifiers
const a = getUser();
const b = a.sessions;
function dka(x: string) { ... }
const tmp = rows.filter((r) => r.active);

// CORRECT — descriptive, intent-driven identifiers
const currentUser = getUser();
const activeSessions = currentUser.sessions;
function deleteKeysByAge(keyPrefix: string) { ... }
const activeRows = rows.filter((row) => row.active);
```

**Rule:** Single-character names are only acceptable in trivial arrow-function predicates (e.g., `.map((x) => x.id)`) where the context is immediately obvious. In all other cases, use a full descriptive name.

---

## Import / Export Conventions

### Imports

- **Always use relative imports** with `.js` extension (ESM requirement)
- Use relative imports (`./`, `../`) — this project does NOT use path aliases
- Use **named imports** for SDK packages: `import { Request, Response } from 'express';`
- Use **default imports** when the module exports a default: `import router from './web/routes/index.js';`

### Exports

- **Named `export class`** for services, handlers, managers, and registries: `export class GitService { ... }`
- **Named `export function`** for standalone functions and providers: `export function createLLMProvider(...)`
- **Named exports** for enums, type aliases, and interfaces
- **`export default router`** for Express route files (`apiRoutes.ts`, `viewRoutes.ts`)
- **Re-exports** via barrel `index.ts` for organized module groups (`enums/index.ts`, `types/index.ts`, `errors/index.ts`)
- Barrel files use `export * from './module.js';` pattern

### Export Patterns by File Type

| File Type            | Export Style                                     | Example                                                |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Services             | Named class export                               | `export class GitService { ... }`                      |
| Command Handlers     | Named class export                               | `export class AgentHandler implements CommandHandler`   |
| Memory classes       | Named class export via barrel                    | `export class ContextLoader { ... }`                   |
| Route files          | Default router export                            | `export default router;`                               |
| Enums                | Named enum export                                | `export enum CommandName { ... }`                      |
| Types / Interfaces   | Named export                                     | `export interface AppConfig { ... }`                   |
| Utility functions    | Named function exports                           | `export function fileExists(...)`                      |
| LangChain tools      | Named const exports + aggregate array            | `export const readFileTool = tool(...); export const ALL_FILE_TOOLS = [...]` |
| Constants            | Named const exports                              | `export const SYSTEM_PROMPT = ...`                     |

---

## Type Definitions

### General Type Rules

- **Minimize `any`** — prefer `unknown`, generics, or concrete types in all new code
- Interfaces live in `types/` organized by domain (`configTypes.ts`, `commandTypes.ts`, `sessionTypes.ts`)
- Interfaces do NOT use an `I` prefix in this project (e.g., `CommandHandler`, not `ICommandHandler`)
- All `types/` modules are re-exported via `types/index.ts` barrel
- The `CommandHandler` interface is the contract for all command handlers
- Zod schemas in `config/index.ts` and `utils/validationUtil.ts` provide runtime validation

### Type Centralization

- **All reusable types** MUST be defined under `src/types/`, grouped by domain
- **Do not** define inline type aliases or complex object types (e.g., in `.map()` or `.filter()` callbacks) inside `services/`, `commands/`, `memory/`, or `tools/` — centralize in `types/` and import
- One exception: one-off interfaces tightly coupled to a single file (e.g., `AssembledContext` in `contextService.ts`) may stay local until reused elsewhere

### Interface Patterns

```typescript
// types/commandTypes.ts — domain-grouped interfaces
export interface CommandArgs {
  [key: string]: unknown;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface CommandHandler {
  name: CommandName;
  description: string;
  execute(args: CommandArgs, sessionId: string): Promise<CommandResult>;
}

// types/githubTypes.ts — domain-grouped interfaces
export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  url: string;
}
```

---

## Error Handling

### Custom Error Hierarchy

All custom errors extend `BaseAppError` in `src/errors/`:

```
BaseAppError (base class)
  ├── GitOperationError     — Git CLI failures (clone, push, checkout, etc.)
  ├── GitHubApiError        — GitHub REST API failures (with HTTP status)
  ├── CommandError          — Command execution failures
  └── ValidationError       — Input validation failures (Zod schema mismatches)
```

### Error Class Pattern

```typescript
// CORRECT — extending BaseAppError
export class GitOperationError extends BaseAppError {
  constructor(operation: string, detail: string, context?: Record<string, unknown>) {
    super(`Git ${operation} failed: ${detail}`, 'GIT_OPERATION_ERROR', 500, true, context);
  }
}
```

### Error Handling Rules

- Always wrap async I/O operations in `try/catch`
- Throw domain-specific errors (`GitOperationError`, `GitHubApiError`, etc.) — never throw raw `Error`
- Log errors with structured metadata before re-throwing or returning:

```typescript
// CORRECT — standard error handling pattern
try {
  await someAsyncOperation();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Failed to do X', {
    source: 'className#methodName',
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw new GitOperationError('operationName', message);
}
```

- In route handlers, always return a proper HTTP response from catch blocks:

```typescript
catch (error: any) {
  log.error('Endpoint error', { source: 'apiRoutes#postChat', error: error.message, stack: error.stack });
  res.status(500).json({ type: 'error', content: 'Internal server error.' });
}
```

- Do NOT add parallel global `unhandledRejection` / `uncaughtException` handlers — the bootstrap in `index.ts` already handles these

---

## Logging

Use **Winston** (`src/logger/index.ts`) for all structured logging. **Never use `console.log`** (except startup warnings in `config/index.ts`).

### Logger Acquisition

```typescript
// At module level — create a child logger scoped to the module
import { createChildLogger } from '../logger/index.js';
const log = createChildLogger('moduleName');

// For per-query tracing — create a child with queryId
import { withQueryId } from '../logger/index.js';
const traceLog = queryId ? withQueryId(log, queryId) : log;
```

### Logger Methods

| Method      | Purpose                    |
| ----------- | -------------------------- |
| `info()`    | Key operational events     |
| `warn()`    | Non-fatal warnings         |
| `error()`   | Error conditions           |
| `debug()`   | Detailed debug information |

### Log Payload Shape

All log calls use positional arguments: `log.level(message, metadataObject)`:

```typescript
// CORRECT — this project's log format
log.info('Creating new session', {
  source: 'sessionManager#createSession',
  sessionId,
  durationMs: Date.now() - startTime,
});

log.error('Failed to clone repository', {
  source: 'gitService#cloneRepository',
  error: error.message,
  stack: error.stack,
});
```

### Source Labeling

**Always** include a `source` field in the metadata object using the format `'moduleName#methodName'`:

```typescript
// CORRECT — source format is 'module#method'
{ source: 'gitService#cloneRepository' }
{ source: 'agentHandler#execute' }
{ source: 'apiRoutes#postChat' }

// For standalone functions (not in a class)
{ source: 'parser#parseUserInput' }
{ source: 'fileUtil#ensureDirectory' }
```

### Query Tracing Pattern

For request-scoped tracing, create a `queryId`-enriched child logger:

```typescript
const traceLog = queryId ? withQueryId(log, queryId) : log;
traceLog.info('Processing chat message', { source: 'chatService#handleChatMessage', sessionId });
```

### Duration Tracking Pattern

Measure and log operation durations with `startTime` + `durationMs`:

```typescript
const startTime = Date.now();
// ... operation
log.debug('Operation complete', {
  source: 'githubService#createPullRequest',
  durationMs: Date.now() - startTime,
});
```

---

## Layered Architecture

Follow this strict layering:

```
Web Routes → Services → Memory / Tools
                     → LLM Providers
Commands (Handlers) → Services → Memory
Graph (Workflow + Nodes) → LLM Providers → Tools
```

### Layer Responsibilities

| Layer              | Location         | Responsibility                                                       |
| ------------------ | ---------------- | -------------------------------------------------------------------- |
| **Routes**         | `web/routes/`    | Define Express routes, validate input, delegate to services           |
| **Services**       | `services/`      | Business logic, orchestration, stateless where possible               |
| **Commands**       | `commands/`      | Parse user input, dispatch to registered handlers                     |
| **Handlers**       | `commands/handlers/` | Execute individual @command logic, delegate to services           |
| **Memory**         | `memory/`        | Context persistence (read/write Markdown files, session management)   |
| **Tools**          | `tools/`         | LangChain tool wrappers exposing service methods to the LLM          |
| **Graph**          | `graph/`         | LangGraph workflow state management and node orchestration            |
| **LLM**           | `llm/`           | Model provider abstraction (Gemini, future OpenAI)                    |
| **Config**         | `config/`        | Environment variable loading and Zod validation                       |
| **Errors**         | `errors/`        | Custom error class hierarchy                                          |
| **Utils**          | `utils/`         | Pure utility functions (no side effects, no logging dependency needed) |
| **Enums**          | `enums/`         | Centralized enum definitions                                          |
| **Types**          | `types/`         | Centralized interface and type definitions                            |

### Layering Rules

- Do NOT put business logic in routes — routes are thin dispatchers
- Services should NOT directly read/write files — delegate to `memory/` classes
- Tools wrap service methods for LLM consumption — they do NOT contain business logic
- Command handlers may instantiate services directly (using default constructor params)
- Utils are **pure functions** — no service dependencies, no side effects beyond basic I/O

---

## Route Module Pattern

Routes live under `src/web/routes/` and use per-domain files with a barrel re-export:

```typescript
// web/routes/apiRoutes.ts — API route definitions
import express from 'express';
const router = express.Router();

router.post('/api/chat', async (req, res) => { ... });
router.get('/api/health', (req, res) => { ... });

export default router;
```

```typescript
// web/routes/index.ts — barrel that mounts all routes
import express from 'express';
import viewRoutes from './viewRoutes.js';
import apiRoutes from './apiRoutes.js';
const router = express.Router();
router.use(viewRoutes);
router.use(apiRoutes);
export default router;
```

---

## Command System Pattern

### Parser → Registry → Handler

1. **Parser** (`commands/parser.ts`): Extracts `@COMMAND_NAME` and args from raw input
2. **Registry** (`commands/registry.ts`): Singleton `Map<CommandName, CommandHandler>` storing handler instances
3. **Handlers** (`commands/handlers/*`): Implement the `CommandHandler` interface

### Command Handler Pattern

```typescript
export class SomeHandler implements CommandHandler {
  public readonly name: CommandName = CommandName.SOME_COMMAND;
  public readonly description: string = 'Human-readable description';

  constructor(
    private readonly someService: SomeService = new SomeService(),
  ) {}

  public async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    log.info('Executing SOME_COMMAND handler', {
      source: 'someHandler#execute',
      sessionId,
    });

    try {
      const result = await this.someService.doWork(args);
      return { success: true, message: 'Done', data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Handler failed', { source: 'someHandler#execute', error: message });
      return { success: false, message: `Failed: ${message}` };
    }
  }
}
```

### Registration

Handlers are registered in `src/index.ts` at bootstrap:

```typescript
commandRegistry.register(new NewSessionHandler());
commandRegistry.register(new AgentHandler());
```

---

## LangChain Tool Pattern

Tools are defined using `@langchain/core/tools`'s `tool()` factory with Zod schemas:

```typescript
export const readFileTool = tool(
  async ({ relativePath }) => {
    log.info('Tool executed: Read File', { source: 'fileTools#readFileTool', relativePath });
    // ... implementation
    return content;
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    schema: z.object({
      relativePath: z.string().describe('The relative path to the file in the workspace'),
    }),
  }
);

// Aggregate all tools in a domain for easy registration
export const ALL_FILE_TOOLS = [readFileTool, writeFileTool, listDirectoryTool];
```

### Tool Rules

- One file per tool domain (`fileTools.ts`, `gitTools.ts`, `githubTools.ts`)
- Each file exports individual named tool constants + an `ALL_*_TOOLS` aggregate array
- Tool `name` uses `snake_case` (LangChain convention)
- Tool `description` is a clear, concise English sentence
- Tool schemas use Zod with `.describe()` on every field
- Log every tool execution at `info` level with `source: 'toolModule#toolName'`
- Tool index barrel (`tools/index.ts`) re-exports all aggregate arrays

---

## LLM Provider Pattern

The LLM layer abstracts model providers behind a factory function:

```typescript
// llm/provider.ts
export function createLLMProvider(config: LLMConfig): BaseChatModel {
  switch (config.provider as LLMProvider) {
    case LLMProvider.GEMINI:
      return createGeminiProvider(config);
    case LLMProvider.OPENAI:
      throw new Error('OpenAI provider not yet implemented');
    default:
      return createGeminiProvider(config);
  }
}

// llm/providers/geminiProvider.ts
export function createGeminiProvider(config: LLMConfig): ChatGoogle {
  return new ChatGoogle({ model: config.model, apiKey: config.apiKey });
}
```

### LLM Rules

- New providers go in `llm/providers/` as a `create*Provider` function
- Add new providers to the `LLMProvider` enum and the switch in `provider.ts`
- Always log provider initialization at `debug` level

---

## LangGraph Workflow Pattern

### State Definition

Graph state is defined using `Annotation.Root`:

```typescript
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  sessionId: Annotation<string>,
  command: Annotation<string>,
  executionLog: Annotation<string[]>({ reducer: (a, b) => [...a, ...b] }),
  // ...
});

export type StateType = typeof AgentState.State;
```

### Workflow Compilation

```typescript
export function buildGraph() {
  const workflow = new StateGraph(AgentState)
    .addNode('contextInjector', contextInjectorNode)
    .addNode('commandRouter', commandRouterNode)
    .addEdge(START, 'contextInjector')
    .addEdge('contextInjector', 'commandRouter')
    .addEdge('commandRouter', END);
  return workflow.compile({ checkpointer: new MemorySaver() });
}
```

### Graph Rules

- State definition in `graph/state.ts`, workflow in `graph/workflow.ts`
- Individual node implementations go in `graph/nodes/` as separate files
- Node functions receive `StateType` and return partial state updates
- Use `executionLog` reducer to append audit trail entries
- Always log node entry at `debug` level

---

## Memory / Context System

### Architecture

```
memory/
  contextLoader.ts    — Read markdown context files (rules, templates, sessions, patterns)
  contextWriter.ts    — Append to markdown context files (rules, learned patterns)
  sessionManager.ts   — CRUD for session JSON + MD snapshot files
  archiveManager.ts   — Cleanup and retention enforcement for archived sessions
  promptInjector.ts   — Assemble LangChain message arrays from context layers
  index.ts            — Barrel re-exports
```

### Context Read Strategy (Per LLM Call)

Only relevant files are loaded — never all:
1. `context/rules/system_rules.md` — Always
2. `context/rules/anti_hallucination.md` — Always
3. `context/agents/code_generation_guidelines.md` — For code tasks
4. `context/commands/<command>.md` — If command detected
5. `context/sessions/session_<id>.md` — Current session
6. `context/memory/learned_patterns.md` — Learned corrections

### Context Write Strategy

- **Rules/Commands/Agents**: Append-only, never overwritten by AI
- **Sessions**: Created and updated during use (JSON + MD dual format)
- **Memory**: Auto-appended when corrections or patterns are learned
- **Archive**: Sessions moved here when archived, auto-purged based on retention days

### Safe File Operations

All file operations use the `fileUtil.ts` helpers:

```typescript
import { fileExists, ensureDirectory, readJson, writeJson } from '../utils/fileUtil.js';
```

- Always check `fileExists()` before reading
- Always call `ensureDirectory()` before writing
- JSON operations use `readJson<T>()` / `writeJson<T>()` for type safety

---

## Service Pattern

Services encapsulate business logic and delegate to memory/managers:

```typescript
export class SessionService {
  private sessionManager = new SessionManager();
  private archiveManager = new ArchiveManager();

  async createSession(): Promise<Session> {
    log.info('Creating new session', { source: 'sessionService#createSession' });
    return this.sessionManager.createSession();
  }

  async archiveSession(sessionId: string): Promise<void> {
    log.info('Archiving session', { source: 'sessionService#archiveSession', sessionId });
    await this.sessionManager.archiveSession(sessionId);
  }
}
```

### Service Rules

- Services use named `export class` (not default exports)
- Dependencies are instantiated in the field declaration or constructor
- Module-scoped `const log = createChildLogger('serviceName')` — NOT instance-level
- Methods log entry at `info` or `debug` level with `source` metadata
- Services do NOT access `req`/`res` — that's the routes' job

---

## Constants & Configuration

### Config (`src/config/index.ts`)

- Environment variables validated via **Zod schema** at startup
- Config is a named export: `export const config: AppConfig`
- Config object is nested by domain: `config.server`, `config.llm`, `config.github`, `config.session`, etc.
- Never hardcode secrets — always reference `process.env.*` via the Zod schema
- Numeric defaults are defined in `config/constants.ts` as named exports

### Constants (`src/constants/`)

- Domain-specific files: `chatConstants.ts`, `commandConstants.ts`
- Exported as named `const` values (not a single default object)
- Multi-line string constants use array `.join('\n')` pattern:

```typescript
export const AGENT_USAGE_GUIDE: string = [
  '## ⚡ @AGENT — Usage',
  '',
  'Please provide a requirement description after `@AGENT`:',
].join('\n');
```

---

## Enum Pattern

Enums live in `src/enums/`, one file per domain, re-exported via `enums/index.ts`:

```typescript
// enums/commandEnum.ts
export enum CommandName {
  AGENT = 'AGENT',
  AGENT_FIX_CODE = 'AGENT_FIX_CODE',
  CREATE_PR = 'CREATE_PR',
  PR_REVIEW = 'PR_REVIEW',
  PR_APPROVE = 'PR_APPROVE',
  MERGE_PR = 'MERGE_PR',
  NEW_SESSION = 'NEW_SESSION',
}
```

### Enum Rules

- Enum names: PascalCase (no `Enum` suffix required, though acceptable)
- Enum members: SCREAMING_SNAKE_CASE for command/action enums, lowercase string values for API enums (`MergeMethod`, `PRState`)
- One file per domain, barrel re-export in `enums/index.ts`
- Always use enum references (not string literals) in application code
- **Inline string union types MUST be replaced with enums.** Whenever a type like `'user' | 'assistant' | 'system' | 'error'` is needed, define it as a properly structured enum with explicitly assigned values, place it in the appropriate `enums/` file, and reference the enum consistently across the codebase

### String Union → Enum Migration Pattern

Do **not** use inline string union types for domain values that appear in more than one location. Instead, define a dedicated enum:

```typescript
// WRONG — inline string union scattered across files
role: 'user' | 'assistant' | 'system' | 'error';

// CORRECT — dedicated enum in enums/
export enum ConversationRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  ERROR = 'error',
}

// Usage — always reference the enum, never the raw string
import { ConversationRole } from '../enums/index.js';
role: ConversationRole;
// ...
if (message.role === ConversationRole.USER) { ... }
```

**Rule:** When introducing or encountering a string union type that represents a finite set of domain values (roles, statuses, categories, etc.), extract it into an enum with explicit string values and update all references to use the enum.

---

## Async Patterns

- Always use `async/await` (never raw `.then()/.catch()` chains for new code)
- Use `Promise.allSettled` for parallel operations that should not fail together
- All file I/O uses `fs/promises` module (never callback-based `fs`)
- All LLM invocations are `await`-ed — never fire-and-forget

---

## Validation

### Zod-Based Validation

Use Zod for all input validation — both config and user input:

```typescript
// utils/validationUtil.ts — generic Zod validator
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMsg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new ValidationError('input', errorMsg);
  }
  return result.data;
}
```

- Use `z.safeParse()` (not `z.parse()`) for graceful error handling
- Throw `ValidationError` on failure (not generic `Error`)
- Tool schemas use Zod with `.describe()` on every field

---

## Governance & Safety Rules

1. **Never auto-merge** — PRs require explicit `@MERGE_PR` command
2. **Never execute destructive Git actions** without user confirmation
3. **Always validate** generated code before committing
4. **Always log** reasoning, actions, and decisions at appropriate levels
5. **Never fabricate** — use tools to read actual files and API data
6. **Human-in-the-loop** — plans require approval before code generation

---

## Code Review Checklist

When reviewing or generating code, verify:

1. **Minimize `any` types** — prefer `unknown` with proper narrowing in all new code
2. **No unused variables** — strict mode enforces this
3. **Proper error handling** — `try/catch` with structured logging, domain-specific error types
4. **`source` in all log metadata** — format: `'moduleName#methodName'`
5. **No `console.log`** — use `createChildLogger()` from `logger/index.js`
6. **`.js` extension on all local imports** — ESM requirement, runtime crash otherwise
7. **Correct naming** — PascalCase classes/enums, camelCase files/folders/vars
8. **Layered architecture** — business logic in services, not in routes or handlers
9. **`const` preferred** — use `const` unless reassignment is needed
10. **Async/await** — no raw promise chains, `Promise.allSettled` for parallel
11. **`catch (error: unknown)`** — use `instanceof Error` narrowing in new code
12. **Folder naming** — all folders use camelCase in this project
13. **Centralized types** — define interfaces in `src/types/`, not inline in services
14. **Zod for validation** — use `z.safeParse()` and throw `ValidationError`
15. **LangChain tools** — Zod schema with `.describe()`, `snake_case` name, `ALL_*_TOOLS` aggregate
16. **Duration tracking** — log `durationMs` for external calls (LLM, GitHub API, Git CLI)
17. **Zero new TypeScript errors** — fix warnings when touching a file
18. **Command handler contract** — implement `CommandHandler` interface, register in `index.ts`
