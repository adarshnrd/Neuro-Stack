# Comprehensive Query Lifecycle Logging System

Add detailed, structured logging across every file in Project NeuroStack to trace the full lifecycle of each user query — from HTTP request entry to response — with correlation IDs for end-to-end traceability.

## User Review Required

> [!IMPORTANT]
> **Correlation ID strategy**: Every incoming request will get a unique `queryId` (UUID) that flows through every function call. This allows you to filter logs by a single ID to see the entire journey of a request. The `queryId` is generated at the API route level and passed through the call chain.

> [!IMPORTANT]
> **Log level strategy**: 
> - `debug` — Granular step-by-step tracing (input parsing, context assembly details, file reads)
> - `info` — Key lifecycle milestones (request received, command dispatched, LLM invoked, response sent)
> - `warn` — Recoverable issues (missing context files, fallback behaviors)
> - `error` — Failures with full stack traces and context

> [!WARNING]
> **Performance consideration**: The `debug`-level logs include message content, parsed args, and context payloads. In production, set `LOG_LEVEL=info` to avoid logging sensitive/verbose data. The current default is already `info`.

## Proposed Changes

### Logger Enhancement

#### [MODIFY] [index.ts](file:///Users/mindpath/Project%20NeuroStack/src/logger/index.ts)

- Add a `createChildLogger(module: string)` factory that wraps the Winston logger to auto-inject a `module` field into every log line
- Add a `withQueryId(queryId: string)` helper that returns a logger with `queryId` baked into all metadata
- Add a dedicated `logs/query-trace.log` transport at `debug` level for deep trace analysis
- Require a `source` field for all logs indicating the file and method (e.g., `filename#methodName`)
- This gives us structured logs like: `2026-04-08 05:20:00 [info]: Chat request received { module: 'apiRoutes', source: 'apiRoutes#chatHandler', queryId: 'abc-123', sessionId: 'xyz' }`

---

### API Layer (Entry/Exit Point)

#### [MODIFY] [apiRoutes.ts](file:///Users/mindpath/Project%20NeuroStack/src/web/routes/apiRoutes.ts)

- Generate `queryId` (UUID) at request entry for `/api/chat`
- Log: request received with `queryId`, `sessionId`, message length, content-type
- Log: response sent with `queryId`, response type, duration (ms)
- Log: validation failures (missing message) with `queryId`
- Log: unhandled errors with full stack trace and `queryId`
- Pass `queryId` downstream to `handleChatMessage`

#### [MODIFY] [viewRoutes.ts](file:///Users/mindpath/Project%20NeuroStack/src/web/routes/viewRoutes.ts)

- Log: view render requests with path info

---

### Chat Service (Core Orchestrator)

#### [MODIFY] [chatService.ts](file:///Users/mindpath/Project%20NeuroStack/src/services/chatService.ts)

- Accept `queryId` parameter
- Log: entry with `queryId`, raw message (truncated for debug)
- Log: parse result — command vs AI branch decision
- Log: command dispatch (which command, handler found/not found)
- Log: command execution result (success/failure)
- Log: LLM invocation start with model info
- Log: LLM response received with token count / response length  
- Log: response type and content length before return
- Log: errors with full context including `queryId`
- Add duration timing for the entire `handleChatMessage` call

---

### Command System

#### [MODIFY] [parser.ts](file:///Users/mindpath/Project%20NeuroStack/src/commands/parser.ts)

- Log: input received for parsing (debug)
- Log: detected command vs plain message
- Log: parsed command name, extracted args (prNumber, method flags)
- Log: unrecognized @ mention vs valid command

#### [MODIFY] [registry.ts](file:///Users/mindpath/Project%20NeuroStack/src/commands/registry.ts)

- Log: handler registration at startup
- Log: handler lookup (hit/miss)
- Log: listing all registered commands

#### [MODIFY] [newSessionHandler.ts](file:///Users/mindpath/Project%20NeuroStack/src/commands/handlers/newSessionHandler.ts)

- Log: handler entry with sessionId and args
- Log: archive of old session
- Log: new session created with new ID
- Log: handler exit with result

---

### LLM Layer

#### [MODIFY] [provider.ts](file:///Users/mindpath/Project%20NeuroStack/src/llm/provider.ts)

- Log: provider selection (which provider, which model)
- Log: fallback to default provider

#### [MODIFY] [geminiProvider.ts](file:///Users/mindpath/Project%20NeuroStack/src/llm/providers/geminiProvider.ts)

- Log: Gemini provider instantiation with model name
- Log: API key presence check (not the key itself)

---

### Graph / Workflow Layer

#### [MODIFY] [workflow.ts](file:///Users/mindpath/Project%20NeuroStack/src/graph/workflow.ts)

- Log: each node entry/exit with node name
- Log: state mutations (what keys changed)
- Log: execution log accumulation
- Log: graph compilation

#### [MODIFY] [state.ts](file:///Users/mindpath/Project%20NeuroStack/src/graph/state.ts)

- No changes needed (pure type definitions)

---

### Memory Layer

#### [MODIFY] [contextLoader.ts](file:///Users/mindpath/Project%20NeuroStack/src/memory/contextLoader.ts)

- Log: each file load attempt (path, exists/not, size)
- Log: rules assembly (how many sections loaded)
- Log: command template load result
- Log: session context load result
- Log: learned patterns load result

#### [MODIFY] [contextWriter.ts](file:///Users/mindpath/Project%20NeuroStack/src/memory/contextWriter.ts)

- Log: file append operations (target path, content length)
- Log: directory creation if needed
- Log: rule append (type: system vs anti_hallucination)
- Log: learned pattern append

#### [MODIFY] [promptInjector.ts](file:///Users/mindpath/Project%20NeuroStack/src/memory/promptInjector.ts)

- Log: prompt assembly start
- Log: each context section inclusion (present/absent, length)
- Log: total assembled prompt message count and length

#### [MODIFY] [sessionManager.ts](file:///Users/mindpath/Project%20NeuroStack/src/memory/sessionManager.ts)

- Log: session create (new ID, expiry)
- Log: session read (found/not found)
- Log: session update (which fields changed)
- Log: session MD file write
- Log: session archive (source/destination paths)
- Log: session purge (which files deleted)

#### [MODIFY] [archiveManager.ts](file:///Users/mindpath/Project%20NeuroStack/src/memory/archiveManager.ts)

- Log: cleanup start with archive path
- Log: each file evaluated (age, decision: keep/delete)
- Log: cleanup summary (files deleted count)
- Log: file size limit enforcement result

---

### Services Layer

#### [MODIFY] [contextService.ts](file:///Users/mindpath/Project%20NeuroStack/src/services/contextService.ts)

- Log: `loadForCommand` entry (command, sessionId)
- Log: assembled context sections (which ones present, lengths)
- Log: learning append
- Log: anti-hallucination rule append

#### [MODIFY] [sessionService.ts](file:///Users/mindpath/Project%20NeuroStack/src/services/sessionService.ts)

- Enhance existing logs with more detail (session IDs, status transitions)
- Log: `addLearningToSession` (session found/not, learning content)
- Log: auto-cleanup results

#### [MODIFY] [gitService.ts](file:///Users/mindpath/Project%20NeuroStack/src/services/gitService.ts)

- Add `debug` logs for operation start/completion timing
- Add success logs after each operation completes
- Log: workspace init, repo check

#### [MODIFY] [githubService.ts](file:///Users/mindpath/Project%20NeuroStack/src/services/githubService.ts)

- Add `debug` logs for API call timing
- Add success logs with returned data summaries (PR number, URL)
- Log: auth mode selection with detail

---

### Tools Layer (LangChain Tools)

#### [MODIFY] [fileTools.ts](file:///Users/mindpath/Project%20NeuroStack/src/tools/fileTools.ts)

- Log: each tool invocation (tool name, input params)
- Log: tool result (success/failure, output summary)
- Log: file not found cases

#### [MODIFY] [gitTools.ts](file:///Users/mindpath/Project%20NeuroStack/src/tools/gitTools.ts)

- Log: each tool invocation with params
- Log: tool completion with result summary

#### [MODIFY] [githubTools.ts](file:///Users/mindpath/Project%20NeuroStack/src/tools/githubTools.ts)

- Log: each tool invocation with params
- Log: tool completion with result summary

---

### Utilities

#### [MODIFY] [fileUtil.ts](file:///Users/mindpath/Project%20NeuroStack/src/utils/fileUtil.ts)

- Log: `debug` for file existence checks, directory creation, JSON read/write
- These are high-frequency calls so only at `debug` level

#### [MODIFY] [validationUtil.ts](file:///Users/mindpath/Project%20NeuroStack/src/utils/validationUtil.ts)

- Log: validation attempts and failures

---

### Entry Point

#### [MODIFY] [index.ts](file:///Users/mindpath/Project%20NeuroStack/src/index.ts)

- Log: startup config summary (port, LLM provider, log level — no secrets)
- Log: command handler registration details
- Log: middleware setup steps
- Log: successful startup with full URL

---

## Files NOT Modified

The following are pure type/enum/constant definition files with no runtime logic — no logging needed:

- `src/types/*.ts` — All type interfaces
- `src/enums/*.ts` — All enums
- `src/constants/chatConstants.ts` — Static string
- `src/config/constants.ts` — Static numbers
- `src/errors/*.ts` — Error class definitions
- `src/graph/state.ts` — Annotation definitions

## Verification Plan

### Automated Tests
1. `npx tsc --noEmit` — Verify the project compiles with no type errors
2. `npm run dev` — Start the dev server, then:
   - `curl http://localhost:3000/api/health` — verify health check works
   - `POST /api/chat` with a test message — verify `queryId` appears in all log lines
3. Verify `logs/query-trace.log` is created and contains debug-level trace data
4. Verify `logs/combined.log` contains info-level lifecycle events with `queryId`

### Manual Verification
- Send a chat message and verify the log output shows the complete query path:
  `apiRoutes → chatService → parser → (command branch OR LLM branch) → response`
- Send a `@NEW_SESSION` command and verify the command path is fully traced
- Check that errors include `queryId` for correlation
