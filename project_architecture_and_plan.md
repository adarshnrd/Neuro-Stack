# Project NeuroStack Architecture & Flow Plan

This document outlines the detailed operations and structure of **Project NeuroStack**. It explains the core mechanics, how folders structure functionality, how user context is managed, how commands map to logic, and how physical Markdown files feed the AI's internal state.

---

## 1. How the System Works
Project NeuroStack acts as an autonomous AI-driven assistant with modular architecture:

1. **Routing and Parsing**: Messages hit the system (via web sockets/REST) and are evaluated by `chatService.ts`. The input is checked via the command parser (`src/commands/parser.ts`) to see if it starts with an `@command`.
2. **Execution Paths**:
   - **Command Path**: If it's a command (e.g. `@new_session`), the parser routes it through the **Command Registry**. Handlers process the commands dynamically and execute functional steps.
   - **Agent/LLM Path**: If not a command, it invokes the centralized LLM chain (`geminiProvider.ts`) built atop LangChain.
3. **Orchestration**: For multi-step actions or robust autonomous tasks, the application uses **LangGraph** (`src/graph/workflow.ts`). LangGraph controls state across different nodes (e.g., Context Injection → Command Routing → Execution/Planning).
4. **Context Injection**: During operations, the context service builds massive context payloads merging static definitions, session history, and coding rules using markdown repositories. 

---

## 2. Directory Structure & Folder Responsibilities

The codebase leverages a modular monolith approach utilizing Domain-Driven structures:

| Folder | Core Responsibility |
| --- | --- |
| `src/commands/` | Defines how commands are parsed, typed, managed in memory (registry), and handled (`handlers/`). |
| `src/config/` & `src/constants/` | Stores global application tuning options like constants, timeouts, and logic switches. |
| `src/enums/` & `src/types/` | The centralized type registry defining interfaces ensuring strict deterministic TypeScript payloads throughout layers. |
| `src/graph/` | Stores state mappings and node definitions for **LangGraph**, handling chained, cyclic behaviors for agent planning. |
| `src/llm/` | Model provider wrappers (like Gemini). Normalizes input/output schema with the AI tools. |
| `src/memory/` | Crucial layer handling state persistency. Contains classes for reading/writing dynamic context, managing session history, tracking memory files, and maintaining learned patterns. |
| `src/services/` | Business logic endpoints (Domain Services). Services orchestrate APIs, Git operations, and conversation streams. |
| `src/tools/` | Core OS capabilities granted to agents (e.g., manipulating files, invoking Git/GitHub commands). |
| `src/web/` | Express route definitions exposing functionalities to web UI endpoints. |
| `context/` | Purely Markdown directories containing system rules, guidelines, learned patterns, and session memory artifacts readable by the model. |

---

## 3. Key Files and Their Purposes

* **`src/index.ts`**: The bootstrap script starting Express servers and initializing registries.
* **`src/services/chatService.ts`**: The top-level intersection matching users' raw text either to `SystemMessage` LLM executions or static command handlers.
* **`src/commands/parser.ts`**: Safely trims and executes RegEx to extract the command action and properties like `#PR_NUMBER` or `--method squash`.
* **`src/graph/workflow.ts`**: Compiles the step-by-step state graph combining `ContextInjector`, `CommandRouter`, and `Planner` nodes in LangGraph.
* **`src/logger/index.ts`**: General logging utility ensuring standard format output without bleeding silent errors.

---

## 4. Context Processing

Context logic is separated into reading (Loading) and assembling (Service). **Context Processing primarily happens here:**
- **`src/memory/contextLoader.ts`**: Directly hits the filesystem (`fs.readFile`) looking for physical rules and system `.md` definitions returning as clean strings.
- **`src/services/contextService.ts`**: Responsible for creating `AssembledContext` mapping for a given request. It bundles:
  1. System Rules
  2. The specific command template triggered
  3. Context from the active session
  4. Memory/learned patterns.

---

## 5. Command Handling Process

Handling specific tools/commands happens completely abstract from typical API routes.

1. **Parser (`src/commands/parser.ts`)**: Evaluates `isCommand` boolean. Builds argument mapping from decorators.
2. **Registry (`src/commands/registry.ts`)**: Statically registers classes inheriting `CommandHandler` via a memory map matching names to specific instances.
3. **Handlers (e.g., `src/commands/handlers/newSessionHandler.ts`)**: Dedicated logic files storing the execution flow of how to execute an individual directive like `@session`.

---

## 6. Model Rules & AI Context (`.md` Storage)

To enforce AI consistency, context patterns are passed strictly via specific `.md` files dynamically loaded per interaction.

The system pulls **Markdown** from the standard workspace locations under `./context`:

### System-Wide Context
- **`context/rules/system_rules.md`**: Foundational system rules describing how NeuroStack should behave overall.
- **`context/rules/anti_hallucination.md`**: Strict guardrails establishing explicit limits mitigating AI dreaming.
- **`context/agents/code_generation_guidelines.md`**: Best practices loaded when invoking code generators to adhere to the tech stack.

### Context by Command
- **`context/commands/<command_name>.md`** (e.g., `agent.md`, `new_session.md`): Only inserted dynamically if the corresponding command is called. Instructs the AI what role to adopt when generating responses specifically executing those procedures.

### Dynamic Memory/Session Context
- **`context/sessions/session_<sessionId>.md`**: Contains tracked conversational history mapping only to the user's current session identifier.
- **`context/memory/learned_patterns.md`**: Shared system-level memory documenting workflows and facts recognized over time, accessed application-wide globally.
