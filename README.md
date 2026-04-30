# 🤖 Project NeuroStack

> **AI-Powered Git Workflow Assistant** — An intelligent development assistant built with Node.js, LangChain, LangGraph, and Google Gemini.

Project NeuroStack understands your development intent through natural language and structured commands, generates production-ready code, manages Git repositories, and handles the full PR lifecycle — all from a single chat interface.

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Commands Reference](#-commands-reference)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Context System](#-context-system-markdown-memory)
- [Session Management](#-session-management)
- [Governance & Safety](#-governance--safety-rules)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)

---

## ✨ Features

- **Natural Language Chat** — Describe what you want in plain English
- **Structured Commands** — 7 deterministic commands for precise control
- **Code Generation** — Production-ready TypeScript code following SOLID principles
- **Git Integration** — Full PR lifecycle (create, review, approve, merge)
- **Markdown Memory** — Persistent context, rules, and learning via `.md` files
- **Model Abstraction** — Plug-and-play LLM switching (Gemini, OpenAI, etc.)
- **Human-in-the-Loop** — No destructive action without explicit approval
- **Session Management** — Smart session lifecycle with auto-archival
- **Anti-Hallucination** — Tool-based execution, validated outputs, learned corrections

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| AI Orchestration | LangGraph (stateful workflows) |
| AI Tooling | LangChain (tools + model abstraction) |
| Default LLM | Google Gemini (`gemini-2.5-flash`) |
| Git (Local) | simple-git |
| Git (Remote) | Octokit (GitHub API) |
| Web Server | Express + Handlebars |
| Real-time | WebSocket (ws) |
| Logging | Winston |
| Validation | Zod |
| Persistence | Markdown files (no database) |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18.x
- **Git** installed and configured
- **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/)
- **GitHub PAT** or GitHub App credentials

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/project-neurostack.git
cd project-neurostack

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys (see Configuration section)

# 4. Start development server
npm run dev

# 5. Open the chat interface
# Navigate to http://localhost:3000
```

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run clean` | Remove build artifacts |

---

## ⚙️ Configuration

All configuration is managed via environment variables in `.env`:

```env
# ──── Server ────
PORT=3000
NODE_ENV=development

# ──── LLM ────
LLM_PROVIDER=gemini              # gemini | openai
LLM_MODEL=gemini-2.5-flash       # Model name
GOOGLE_API_KEY=your-key-here      # Required for Gemini

# ──── GitHub Auth (Option 1: PAT — recommended for Phase 1) ────
GITHUB_TOKEN=ghp_your-token-here

# ──── GitHub Auth (Option 2: GitHub App) ────
# GITHUB_APP_ID=12345
# GITHUB_PRIVATE_KEY_PATH=./private-key.pem
# GITHUB_INSTALLATION_ID=67890

# ──── Repository ────
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
GITHUB_DEFAULT_BRANCH=main

# ──── Paths ────
WORKSPACE_PATH=./workspace
CONTEXT_PATH=./context

# ──── Session ────
SESSION_ACTIVE_WINDOW_HOURS=5     # Session active window (1-5 hours)
SESSION_RETENTION_DAYS=2          # Keep session data for N days
SESSION_AUTO_PURGE_DAYS=4         # Auto-delete after N days inactivity

# ──── Context ────
CONTEXT_MAX_FILE_SIZE_KB=500
ARCHIVE_RETENTION_DAYS=30

# ──── Logging ────
LOG_LEVEL=info                    # error | warn | info | debug
```

### Authentication Priority

If both PAT and GitHub App credentials are provided, PAT takes priority.

---

## 📖 Commands Reference

All commands are prefixed with `@` and can be typed in the chat input.

### `@AGENT`

> **Generate code from a requirement description.**

```
@AGENT Create a user authentication system with JWT tokens
```

**Workflow:**
1. Analyzes your requirement
2. Asks clarifying questions (if needed)
3. Generates a structured technical plan
4. Waits for your approval
5. Generates production-ready code
6. Suggests creating a PR with `@CREATE_PR`

---

### `@AGENT_FIX_CODE`

> **Analyze and fix issues in existing code.**

```
@AGENT_FIX_CODE Fix the authentication middleware — tokens are not being validated
```

**Workflow:**
1. Analyzes the reported issue
2. Reads relevant source files
3. Identifies root cause
4. Generates a fix
5. Presents the fix for approval

---

### `@CREATE_PR`

> **Create a pull request from generated or existing code.**

```
@CREATE_PR Create PR for the JWT authentication feature
```

**Workflow:**
1. Creates a new branch (auto-named)
2. Stages and commits generated files
3. Pushes to remote
4. Creates a GitHub PR with description
5. Returns PR number and URL

---

### `@PR_REVIEW`

> **Perform a detailed review of a pull request.**

```
@PR_REVIEW #42
```

**Workflow:**
1. Fetches the PR diff from GitHub
2. Analyzes code quality, potential bugs, and improvements
3. Returns structured review with:
   - Summary
   - Issues found (critical/warning/info)
   - Line-specific comments
   - Recommendations

---

### `@PR_APPROVE`

> **Approve a pull request after validation.**

```
@PR_APPROVE #42
```

**Workflow:**
1. Fetches PR details
2. Validates review status
3. Submits approval via GitHub API
4. Confirms approval to user

---

### `@MERGE_PR`

> **Merge a pull request. Requires explicit command — never auto-merges.**

```
@MERGE_PR #42
@MERGE_PR #42 --method squash
```

**Options:**
- `--method merge` (default) — Standard merge commit
- `--method squash` — Squash and merge
- `--method rebase` — Rebase and merge

**Workflow:**
1. Verifies PR is approved
2. Asks for final confirmation
3. Merges via GitHub API
4. Confirms merge with commit SHA

> ⚠️ **Governance Rule**: PRs are NEVER auto-merged. This command requires explicit user action.

---

### `@NEW_SESSION`

> **Archive the current session and start fresh.**

```
@NEW_SESSION
```

**Workflow:**
1. Summarizes current session
2. Archives session to `context/archive/`
3. Creates a new session file
4. Resets conversation context
5. Confirms: _"New session started. Session `<old-id>` archived."_

---

### General Chat (No Command)

Any message without a `@` prefix is treated as a general conversation:

```
What's the best way to structure a REST API in Express?
Explain how JWT refresh tokens work.
```

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────┐
│                   Web Layer                       │
│   ┌──────────┐  ┌────────────┐  ┌─────────────┐ │
│   │ Chat UI  │→ │ WebSocket  │→ │ Express API │ │
│   │  (HBS)   │  │  Server    │  │  Routes     │ │
│   └──────────┘  └────────────┘  └─────────────┘ │
└───────────────────────┬──────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────┐
│               Command System                      │
│   ┌──────────────┐  ┌──────────────────────────┐ │
│   │ Parser       │→ │ Registry + Handlers      │ │
│   │ (@COMMAND)   │  │ (7 commands)             │ │
│   └──────────────┘  └──────────────────────────┘ │
└───────────────────────┬──────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────┐
│            LangGraph Workflow Engine              │
│   ┌────────┐ ┌──────┐ ┌─────┐ ┌──────────────┐ │
│   │Planner │ │Coder │ │Rev. │ │ Approval     │ │
│   │  Node  │ │ Node │ │Node │ │ (interrupt)  │ │
│   └────────┘ └──────┘ └─────┘ └──────────────┘ │
└───────────────────────┬──────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────┐
│              Services + Tools                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│   │Git Service│  │GitHub Svc│  │Context Svc   │ │
│   │(simple-git)│ │(Octokit) │  │(MD read/write│ │
│   └──────────┘  └──────────┘  └──────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
project-neurostack/
├── src/                    # Application source code
│   ├── index.ts            # Entry point
│   ├── config/             # Configuration & constants
│   ├── types/              # TypeScript interfaces (by domain)
│   ├── enums/              # TypeScript enums (by domain)
│   ├── errors/             # Custom error class hierarchy
│   ├── llm/                # LLM abstraction (Gemini, OpenAI)
│   ├── commands/           # Command parser, registry, handlers
│   ├── graph/              # LangGraph state, nodes, workflow
│   ├── services/           # Business logic layer
│   ├── tools/              # LangChain tool wrappers
│   ├── memory/             # Markdown context management
│   ├── logger/             # Winston structured logger
│   ├── utils/              # Pure utility functions
│   └── web/                # Express server, routes, views
├── context/                # Markdown-based persistence
│   ├── rules/              # System rules (permanent)
│   ├── commands/           # Command templates (permanent)
│   ├── agents/             # AI agent guidelines (permanent)
│   ├── sessions/           # Active sessions (rotatable)
│   ├── memory/             # Learned patterns (permanent)
│   ├── workflows/          # Workflow definitions (permanent)
│   └── archive/            # Archived sessions
├── public/                 # Static web assets
├── logs/                   # Runtime logs
├── workspace/              # Cloned repository
└── .env                    # Environment configuration
```

---

## 🧠 Context System (Markdown Memory)

NeuroStack uses structured Markdown files instead of a database:

| Directory | Purpose | Retention |
|-----------|---------|-----------|
| `context/rules/` | System identity, anti-hallucination | ♾️ Permanent |
| `context/commands/` | Command prompt templates | ♾️ Permanent |
| `context/agents/` | Code generation guidelines | ♾️ Permanent |
| `context/workflows/` | Workflow definitions | ♾️ Permanent |
| `context/memory/` | Learned patterns & corrections | ♾️ Permanent |
| `context/sessions/` | Active session summaries | 1–2 days |
| `context/archive/` | Archived sessions | 30 days |

### Read Strategy (Per LLM Call)
Only relevant files are loaded — never all:
1. `rules/system_rules.md` — Always
2. `rules/anti_hallucination.md` — Always
3. `agents/code_generation_guidelines.md` — For code tasks
4. `commands/<command>.md` — If command detected
5. `sessions/session_<id>.md` — Current session
6. `memory/learned_patterns.md` — Last 50 entries

### Write Strategy
- **Rules/Commands/Agents**: Append-only, never overwritten by AI
- **Sessions**: Created and updated during use
- **Memory**: Auto-appended when corrections or patterns are learned

---

## ⏱ Session Management

| Behavior | Rule |
|----------|------|
| Active window | 1–5 hours (configurable) |
| Expiry prompt | After window expires, suggest `@NEW_SESSION` |
| Context retention | 1–2 days after last activity |
| Pre-delete | Show summary + ask confirmation before deleting |
| Auto-purge | 3–4 days of no activity → auto-delete |
| Archive | Completed sessions moved to `context/archive/` |

---

## 🔐 Governance & Safety Rules

1. **Never auto-merge** — PRs require explicit `@MERGE_PR`
2. **Never execute destructive actions** without user confirmation
3. **Always validate** generated code before committing
4. **Always log** reasoning, actions, and decisions
5. **Never fabricate** — use tools to read actual files and API data
6. **Human-in-the-loop** — plans require approval before code generation

---

## 🗺 Roadmap

### Phase 1: Foundation ✅ (Current)
Core architecture, command system, Git integration, markdown memory, web UI

### Phase 2: Intelligence
Multi-agent system, vector store, enhanced reviews, SQLite persistence

### Phase 3: CI/CD
GitHub Actions, automated tests, build monitoring, webhooks

### Phase 4: Team
Slack/Teams integration, RBAC, shared knowledge base, audit trails

### Phase 5: Enterprise
Multi-tenant, fine-tuning, plugin system, analytics dashboard

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Follow the [Code Generation Guidelines](./context/agents/code_generation_guidelines.md)
4. Commit with conventional commits: `feat:`, `fix:`, `docs:`
5. Submit a PR

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
