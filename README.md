# 🤖 Project NeuroStack

> **Autonomous, multi-model AI development agent.** Describe what you want in plain English (or a
> `.md` spec) and NeuroStack plans, writes code, runs commands, tests, and iterates until it's done —
> and it **never stops when one model hits its limit**, handing off across providers and checkpointing
> to disk so work resumes exactly where it left off.

Built with Node.js + TypeScript, LangChain, LangGraph, and a role-based router over **Google Gemini,
Groq, and NVIDIA NIM**.

---

## ✨ Highlights

- **Folder Agent** — point it at a local folder; it works directly inside it like Claude Code: reads
  files, writes changes, runs terminal commands, and loops (plan → implement → verify → fix) until the
  task is complete. CLI **and** web UI.
- **Cross-model continuity** — when a model exhausts its quota/rate limit mid-task, NeuroStack hands off
  to the next provider in the chain and continues without losing work. When every provider is spent, it
  pauses gracefully and resumes later.
- **Durable filesystem state** — every run tracks progress in a `.neurostack/` state store (plan,
  progress log, rolling summary, decisions, open issues, snapshots). Kill it mid-run and `resume`
  picks up from disk. **No git involvement** — version control stays 100% manual.
- **Role-based multi-model routing** — each stage (plan, code, review, summarize, validate) runs on the
  best-suited model, with automatic fallback chains.
- **Two permission modes** — `auto` (runs freely, asks only before high-risk commands) and `manual`
  (asks before every command). Commands are cwd-locked to the selected folder.
- **Chat interface** — multi-turn conversation plus structured `@commands`, with staged human-review of
  AI-generated changes.

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥ 18 + TypeScript (strict, ESM) |
| Orchestration | LangGraph (stateful agent loop) + LangChain (tools, model abstraction) |
| Models | **Gemini** (`gemini-2.5-flash`), **Groq** (`llama-3.3-70b`), **NVIDIA NIM** (Nemotron 30B nano + 550B Ultra) |
| Persistence (app) | Supabase / Postgres (users, sessions, conversations) |
| Persistence (runs) | Filesystem `.neurostack/` state store |
| Git / GitHub | simple-git · Octokit |
| Web | Express + Handlebars + Server-Sent Events |
| Auth | Signed session tokens (HMAC) + bcrypt |
| Logging / Validation | Winston · Zod |
| Quality | Vitest · ESLint · GitHub Actions CI |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18, Git
- A **Supabase** project (URL + secret key)
- At least one model key: **Google Gemini** (recommended primary), optionally **Groq** and **NVIDIA NIM**

### Install & configure
```bash
git clone <repo-url> && cd "Project NeuroStack"
npm install
cp .env.example .env      # fill in the values below
```

### Database
Run the SQL migrations in the Supabase SQL Editor, in order:
1. `src/database/migrations/001_initial_schema.sql`
2. `src/database/migrations/002_fix_rls_policies.sql`

### Run
```bash
npm run dev               # web server at http://localhost:3000
```
- Chat UI: `http://localhost:3000/app`
- Folder Agent UI: `http://localhost:3000/folder`

Or drive the folder agent from the CLI (no server needed):
```bash
npm run folder /path/to/project "Add an Express /health endpoint with a test, then run the tests and fix until they pass"
```

---

## ⚙️ Configuration

```env
# ── Server ──
PORT=3000
NODE_ENV=development

# ── Models ──
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GOOGLE_API_KEY=                       # Gemini (primary coder/chat)
GROQ_API_KEY=                         # Groq — fast fallback + summarize/validate roles
GROQ_MODEL=llama-3.3-70b-versatile
NVIDIA_API_KEY=                       # NVIDIA nano — reasoning + last-resort coder
NVIDIA_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
NVIDIA_ULTRA_API_KEY=                 # NVIDIA Ultra 550B — planning + review
NVIDIA_ULTRA_MODEL=nvidia/nemotron-3-ultra-550b-a55b

# ── Supabase (required) ──
SUPA_BASE_PROJECT_URL=
SUPA_BASE_DB_API_KEY=

# ── Auth ──
SESSION_SECRET=                       # ≥32 chars; generate with:
                                      #   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ── Folder Agent ──
FOLDER_AGENT_ROOT=                    # base dir the web folder-picker may browse (default: home dir)

# ── GitHub (optional; manual PR flows) ──
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
```
Only Gemini + Supabase are strictly required; Groq and NVIDIA are optional but unlock the fallback
chains and reduce free-tier pausing.

---

## 🧠 Multi-Model Routing

Every stage of work runs on the model best suited to it, and each role has an ordered **fallback
chain** — if a provider errors or is exhausted, the next one takes over automatically.

| Role | Chain (first available wins) | Why |
|------|------------------------------|-----|
| **Planner** | Ultra 550B → nano → Gemini → Groq | Deep reasoning once per task; quality compounds |
| **Coder** | Gemini → Groq → NVIDIA nano | Proven tool-calling; three-deep so it rarely pauses |
| **Reviewer** | Ultra 550B → nano → Gemini → Groq | Fresh-context, different family than the coder (counters self-review bias) |
| **Summarizer** | Groq → Gemini | Fast + cheap; runs every iteration |
| **Validator** | Groq → Gemini | Strict JSON verdicts, near-free |
| **Chat** | Gemini → Groq → NVIDIA nano | Availability |

Errors are classified as **retryable** (back off, same provider), **exhausted** (fail over to the next
model), or **fatal** (surface). `npm run smoke:providers` exercises every role live.

---

## 📂 The Folder Agent

The headline capability: autonomous development inside a real project folder.

```bash
npm run folder <folder> "<prompt>"          # start a run (auto mode)
npm run folder <folder> "<prompt>" --manual # ask before every command
npm run folder resume <folder>              # continue an interrupted/paused run
npm run folder status <folder>              # show progress + rolling summary
```
Or use the web UI at `/folder`: browse to a folder, describe the work, watch progress stream live, and
approve high-risk commands inline.

**How it works**
1. The folder is opened as a sandboxed, direct-apply workspace (validated: must exist, be writable, not
   a sensitive root). Writes are transactional (temp + atomic rename).
2. It's indexed (stack + test-runner detection + file tree) so every model starts situationally aware.
3. The PLANNER decomposes the task into tracked subtasks (`plan.json`).
4. The CODER loop runs: read → write → `run_command` (install/build/test) → read output → fix → repeat.
5. Progress is persisted every step to `.neurostack/`.
6. On model exhaustion it hands off to the next provider; when all are spent it **pauses resumably**.

**Permission modes** — `auto` runs ordinary commands freely and only pauses for approval on genuinely
dangerous ones (`rm -rf`, `git push --force`, `dd`, `sudo`, piping remote scripts to a shell, …);
`manual` pauses before every command. Everything is cwd-locked to the folder.

**`.neurostack/` state store** (recovery mechanism — no git):
```
.neurostack/
├── spec.md              # the task
├── plan.json            # subtasks + statuses
├── progress-log.jsonl   # append-only event log
├── context-summary.md   # compact, model-portable "state of the world"
├── decisions.md         # decisions made (incl. model handoffs)
├── open-issues.md       # blockers / things to watch
├── project-map.json     # cached project index
├── snapshots/           # pre-write file backups (filesystem-level undo)
└── state.json           # run status (running/paused/complete/failed)
```

---

## 💬 Chat Commands

Type in the chat UI at `/app`. Non-command messages are normal multi-turn conversation.

| Command | What it does |
|---------|--------------|
| `@AGENT <requirement>` | Tool-using code generation; changes are **staged for review** in a visual diff before you accept |
| `@AGENT_LOOP <requirement>` | Autonomous plan → implement → verify → review → judge loop (LangGraph), streamed live |
| `@NEW_SESSION` | Archive the current session and start fresh |

Generated changes never auto-apply in chat mode — you review and accept them.

---

## 🏗 Architecture

```
Web (Express + Handlebars + SSE)  ─┬─  Chat UI (/app)        ── @commands + conversation
                                   └─  Folder Agent UI (/folder) ── browse · run · approve
                     │
        Command registry / routes / auth middleware
                     │
   ┌─────────────────┼───────────────────────────────┐
   │                 │                                │
 Agent loop      Folder agent                    LLM layer
 (LangGraph)     (ReAct + state store)           modelRouter → role chains → failover
   │                 │                                │
   └── Services: changeset review · verification (sandboxed) · context · git/github
   └── Tools: file (staged or direct) · run_command (cwd-locked) · run_check · git · github
   └── Persistence: Supabase (users/sessions/conversations) · .neurostack/ (runs)
```

---

## 📁 Project Structure

```
src/
  llm/            # provider factories, model router, role chains, agent loop, retry/failover
  graph/          # LangGraph agent-loop (state, nodes, workflow)
  services/       # folder agent, state store, workspace, verification, changeset, project indexer, auth…
  tools/          # file, shell (run_command), verify (run_check), git, github tools
  commands/       # @command parser, registry, handlers
  web/            # Express routes (chat, folder, review, auth), middleware, Handlebars views
  database/       # Supabase client, repositories, SQL migrations
  memory/         # markdown context (rules, patterns) + prompt injection
  config/ types/ enums/ errors/ utils/ logger/
scripts/          # smokeProviders, agentFolder (CLI)
evals/            # benchmark tasks + harness (npm run eval)
tests/            # vitest suite
```

---

## 🔐 Security

Signed HMAC session tokens with expiry; bcrypt password hashing; per-user ownership checks on sessions
and conversations; rate limiting on auth endpoints; security headers; path-traversal guards on all file
operations; sandboxed verification (checks run on a temp copy, never the real workspace before approval);
DOMPurify sanitization of rendered model output; scoped, cwd-locked shell execution with a catastrophic-
command denylist. Supabase RLS is locked down in migration `002`.

---

## 📜 Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` / `start` | Compile / run compiled server |
| `npm run folder …` | Folder agent CLI (start / resume / status) |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run eval` | Run the agent-loop benchmark harness |
| `npm run smoke:providers` | Live-test every model role across providers |

CI (GitHub Actions, `.github/workflows/ci.yml`) runs typecheck + lint + tests on push/PR.

---

## 🗺 Roadmap

**Done:** multi-model routing + failover · staged-review `@AGENT` · autonomous `@AGENT_LOOP` · folder
agent (CLI + web) · autonomous shell with permission modes · durable `.neurostack/` state + resume ·
cross-model handoff · project indexing · task decomposition · security hardening · tests + CI.

**Next:** true FS sandboxing (container) for shell isolation · full dependency-graph task scheduler ·
richer web status dashboard · remaining PR-lifecycle commands (`@CREATE_PR` → `@MERGE_PR`).

See [`plans/`](plans/) for detailed design docs and decision history.

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
