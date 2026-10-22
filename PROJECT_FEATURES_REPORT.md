# Project NeuroStack — Comprehensive Features & Capabilities Report

**Application:** Project NeuroStack (Autonomous Multi-Model AI Development Agent)  
**Architecture:** Node.js (ESM), TypeScript (Strict), Express 4, LangChain, LangGraph, Supabase Postgres, Handlebars  
**Primary Models:** Google Gemini 2.5 Flash, Groq (Llama 3.3 70B), NVIDIA NIM (Nemotron 30B Nano & Ultra 550B)  
**Date:** October 2026  

---

## 1. Executive Summary & Capabilities Overview

**Project NeuroStack** is an autonomous, full-stack AI software development system. It functions as an intelligent pair programmer, terminal operator, and Git/GitHub release manager that can work either in an interactive chat session or directly inside any local folder on your computer.

### Core Architectural Highlights
* **Folder Agent:** Works inside real local folders like Claude Code — reads existing code, writes changes, executes terminal commands (install, build, test), inspects errors, and self-corrects until tasks are complete.
* **Cross-Model Continuity & Resumability:** When one model exhausts its quota or rate limit mid-task, NeuroStack automatically hands off to the next model in the fallback chain. Progress is snapshotted to a durable filesystem store (`.neurostack/`) so runs survive restarts and model pauses.
* **Non-Destructive Version Control:** The autonomous agent loop never modifies Git history without explicit user command — version control remains opt-in and manual.
* **Dual Execution Modes:** Available both as an interactive **Web Application** (`http://localhost:3000`) with Server-Sent Events (SSE) streaming and as a headless **CLI Tool**.

---

## 2. Developing Code in Another Local Folder (The Folder Agent)

> **Can we develop code in another local folder?**  
> **Yes, absolutely!** In fact, this is the **headline capability** of Project NeuroStack.

NeuroStack does not restrict you to its own repository. You can point it to **any directory on your machine** (e.g. an existing Express app, a React frontend, a Python microservice, or a completely blank folder), and NeuroStack will operate directly inside that workspace.

---

### A. How the Folder Agent Works

```
Target Local Folder
       │
       ▼
1. Indexing & Situational Awareness:
   Detects package manager, runtime (Node/Python/Go/Rust), test runner, and builds a file tree.
       │
       ▼
2. Planning & Decomposition (PLANNER model):
   Breaks the requirement into checkable subtasks saved to `<folder>/.neurostack/plan.json`.
       │
       ▼
3. Autonomous Execution Loop (CODER model):
   ┌──────────────────────────────────────────────────────────┐
   │  • Reads files (list_directory, read_file)               │
   │  • Takes pre-write snapshots for undo in .neurostack/    │
   │  • Writes atomic updates directly to files (write_file)  │
   │  • Executes commands in target cwd (run_command)         │
   │  • Inspects compiler/test stdout & stderr                │
   │  • Fixes errors and re-tests until green                │
   └──────────────────────────────────────────────────────────┘
       │
       ▼
4. Persistence & Completion:
   Persists progress log, rolling summary, and decisions to `<folder>/.neurostack/`.
```

---

### B. Option 1: Using the Web UI (`/folder`)

1. Start the server using `start.bat` or `npm run dev`.
2. Open your browser and navigate to **`http://localhost:3000/folder`**.
3. **Select or enter your folder path:**
   * You can use the built-in directory browser or enter the absolute path (e.g., `E:\MyOtherProject` or `C:\Users\Adarsh\projects\test-api`).
4. **Choose Permission Mode:**
   * **Auto Mode (Default):** Runs everyday commands (npm test, build, lint) autonomously, only pausing for approval on high-risk operations (e.g., `rm -rf`, force pushes, system deletions).
   * **Manual Mode:** Prompts you for approval before running *every* shell command.
5. **Describe your requirement:**
   * Enter your task (e.g., *"Add an Express /health endpoint with a Vitest test, then run the test suite and iterate until it passes"*).
6. **Watch Live Execution:**
   * Watch the subtasks, tool actions, and terminal outputs stream in real time via Server-Sent Events (SSE).

---

### C. Option 2: Using the CLI (`npm run folder`)

You do not even need the web server running to operate on another folder. You can drive the Folder Agent directly from your terminal:

#### 1. Start an autonomous task in a local folder:
```bash
npm run folder "E:\MyOtherProject" "Add user authentication middleware with unit tests"
```

#### 2. Run with manual approval before every command:
```bash
npm run folder "E:\MyOtherProject" "Refactor database queries" --manual
```

#### 3. Resume an interrupted or paused task:
```bash
npm run folder resume "E:\MyOtherProject"
```
*(If a model quota was exhausted or you stopped the process, `resume` picks up exactly where it left off using the saved state on disk).*

#### 4. Inspect folder task status and summary:
```bash
npm run folder status "E:\MyOtherProject"
```

---

### D. The `.neurostack/` State Store (Zero-Git Recovery)

Inside the target local folder, NeuroStack creates a `.neurostack/` state store so you never lose work:

```
<target-folder>/.neurostack/
├── spec.md              # The user requirement specification
├── plan.json            # Decomposed subtasks with completion status
├── progress-log.jsonl   # Append-only chronological event log
├── context-summary.md   # Model-portable summary of the project state
├── decisions.md         # Key architecture decisions & model handoff history
├── open-issues.md       # Blockers or pending items to watch
├── project-map.json     # Cached project stack & structure index
├── snapshots/           # Automatic pre-write backups (undo mechanism)
└── state.json           # Run state (running, paused, completed, failed)
```

---

## 3. Multi-Model Routing & Automatic Failover

NeuroStack uses a role-based router distributing tasks to the best-suited model family, with zero-downtime failover:

| Role | Preferred Model & Fallback Chain | Responsibilities |
|---|---|---|
| **Planner** | `NVIDIA Ultra 550B` → `Nemotron Nano 30B` → `Gemini 2.5 Flash` → `Groq (Llama 3.3 70B)` | High-parameter deep reasoning to decompose requirements into plans. |
| **Coder** | `Gemini 2.5 Flash` → `Groq (Llama 3.3 70B)` → `NVIDIA Nemotron Nano 30B` | Rapid code editing, file manipulation, and tool execution. |
| **Reviewer** | `NVIDIA Ultra 550B` → `Nemotron Nano 30B` → `Gemini 2.5 Flash` → `Groq` | Fresh-context review from a different model family to avoid self-review bias. |
| **Summarizer** | `Groq (Llama 3.3 70B)` → `Gemini 2.5 Flash` | Rapid, low-latency rolling state summaries generated every iteration. |
| **Validator** | `Groq (Llama 3.3 70B)` → `Gemini 2.5 Flash` | Strict JSON verdict generation for code pass/fail checks. |
| **Chat** | `Gemini 2.5 Flash` → `Groq` → `NVIDIA Nemotron Nano 30B` | Conversational responses in the chat UI. |

* **Automatic Failover:** If an API hits 429 rate limits, token exhaustion, or outage errors, the router automatically fails over to the next provider in the chain without losing context.
* **Live Smoke Testing:** Run `npm run smoke:providers` to test every provider live.

---

## 4. LangGraph Agent Loop & Visual Staged Review

In addition to direct folder editing, NeuroStack provides a safe **Staged Changeset Review** mode for chat sessions:

1. **Stateful Graph Execution:** Powered by LangGraph (`StateGraph`), orchestrating planning, drafting, verification, and human review nodes.
2. **Sandboxed Verification:** When generating code, NeuroStack copies files to an isolated temporary directory, runs builds and checks, and only stages them if verification passes.
3. **Visual Diff Review:** Code changes are presented in an interactive diff in the Chat UI. The user can inspect the changes before clicking **Accept** or **Reject**.
4. **Resumable Approval Gate:** Human-in-the-loop checkpointing allows pausing at the approval gate and resuming seamlessly.

---

## 5. Chat Interface & Structured Commands

Available in the Chat UI at **`http://localhost:3000/app`**:

| Command | Syntax | Description |
|---|---|---|
| **Autonomous Agent** | `@AGENT <requirement>` | Generates code changes with tool calls; stages files in a visual diff for your approval. |
| **Autonomous Loop** | `@AGENT_LOOP <requirement>` | Runs the full LangGraph plan → implement → verify → review loop with real-time SSE streaming. |
| **Create Pull Request** | `@CREATE_PR <description>` | Automatically creates a new Git branch, commits staged changes, pushes to remote, and opens a GitHub PR. |
| **PR Code Review** | `@PR_REVIEW #<number>` | Fetches the diff of any open GitHub PR and returns an AI code review with findings. |
| **PR Approval** | `@PR_APPROVE #<number>` | Submits an official approving review on GitHub. |
| **PR Merge** | `@MERGE_PR #<number> [--method squash]` | Checks PR mergeability and merge status, then merges via GitHub API (`merge`, `squash`, or `rebase`). |
| **Session Reset** | `@NEW_SESSION` | Archives the current chat session and starts a clean conversation context. |

---

## 6. Security, Authentication & Safety Controls

1. **Authentication & Session Tokens:**
   * Signed HMAC session tokens with configurable TTL (`SESSION_SECRET`).
   * Password hashing via `bcrypt` (12 salt rounds).
   * Role-Based Access Control (`admin`, `user`, `viewer`). Sensitive PR commands require admin privileges.
2. **Shell Security & Denylist:**
   * Working directory locked strictly to the target project folder (`cwd`-locked).
   * Catastrophic command denylist prevents execution of dangerous system calls (`rm -rf /`, formatting drives, raw disk writes).
   * Interactive permission broker prompts the user before executing elevated commands.
3. **Filesystem Traversal Protection:**
   * Path validation ensures no tool can read or write outside the designated workspace root.
   * Atomic file writes using temporary files and atomic rename operations.

---

## 7. Memory & Context Persistence Architecture

* **Supabase PostgreSQL:** Stores users, user sessions, conversation histories, and context snapshots.
* **Structured Markdown Memory:** Persists long-term knowledge across restarts:
  * `context/rules/` — Permanent system rules and anti-hallucination policies.
  * `context/commands/` — Command prompt templates.
  * `context/agents/` — Coding guidelines and architecture best practices.
  * `context/memory/` — Learned patterns and corrections recorded from user feedback.
  * `context/sessions/` & `context/archive/` — Active and archived session summaries.

---

## 8. Quick Reference Command Cheat Sheet

| Action | Command / Location |
|---|---|
| **Start Web App (UI + API)** | `start.bat` or `npm run dev` (`http://localhost:3000`) |
| **Open Chat UI** | `http://localhost:3000/app` |
| **Open Folder Agent UI** | `http://localhost:3000/folder` |
| **Run Folder Agent on ANY folder** | `npm run folder <path> "<task>"` |
| **Run Folder Agent with manual approval** | `npm run folder <path> "<task>" --manual` |
| **Resume Folder Agent run** | `npm run folder resume <path>` |
| **Check Folder Agent status** | `npm run folder status <path>` |
| **Run Complete Test Suite** | `npm test` (`vitest run`) |
| **Type Check Codebase** | `npm run typecheck` (`tsc --noEmit`) |
| **Build for Production** | `npm run build` (`tsc`) |
| **Smoke Test AI Providers** | `npm run smoke:providers` |
