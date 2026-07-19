# Project NeuroStack — Improvement Plan

> Full-project audit performed 2026-07-18. Covers security, correctness, architecture, and
> quality infrastructure. Items are ordered by priority; each phase is independently shippable.

## ✅ Execution status (updated 2026-07-18)

**All P0 security items are implemented**, along with the P1 bug fixes, the LLM retry
service, and the quality floor (ESLint, vitest with 25 tests, GitHub Actions CI, LICENSE).
Verified: `npm run typecheck` ✓, `npm run lint` ✓ (0 errors), `npm test` ✓ (25/25),
plus a live smoke boot exercising auth gates, redirects, security headers, and legacy-token
rejection.

**Manual step required:** run `src/database/migrations/002_fix_rls_policies.sql` in the
Supabase SQL Editor — the app cannot apply it itself.

**Recommended:** add a permanent `SESSION_SECRET` to `.env` (see `.env.example`); until then
a random per-boot secret is used and restarts log everyone out.

**Still open (need product decisions):** LangGraph wire-or-remove, persistence-story docs
truth-up, real SSE streaming, remaining command handlers, vendoring CDN assets + CSP.

---

## Current State Snapshot

**What's solid:**
- Clean layered architecture (routes → services → repositories) with consistent structured logging and query-ID tracing
- Strict TypeScript compiles with zero errors (`npx tsc --noEmit` passes)
- Changeset staging/review flow for AI-generated file changes (human-in-the-loop works)
- Supabase persistence for users/sessions/conversations with sensible schema and indexes
- In-flight work (uncommitted): multi-turn LLM context, lazy session creation, session titles — direction is good

**Biggest gaps:** authorization checks, real auth tokens, zero tests, no lint enforcement,
documented-but-missing features (LangGraph, WebSocket, 6 of 8 commands), and docs that
describe an architecture the code no longer matches.

---

## P0 — Security (do before any new features)

### 1. Session ownership checks (IDOR) — highest priority
Any authenticated user can read or write **any other user's sessions** by supplying a session ID:
- `POST /api/chat` accepts an arbitrary `sessionId` — writes to it AND feeds that session's
  conversation history into the LLM context (`chatService.ts` → `getRecentConversations`),
  leaking another user's conversation content in responses
- `GET /api/sessions/:sessionId` and `GET /api/sessions/:sessionId/conversations` never compare
  `session.userId` to `req.userId`
- All `/api/review/:changeSetId/*` routes (including `accept`, which **writes files to disk**)
  have no ownership check

**Fix:** in each route, load the session/changeset, return 404 if `userId !== req.userId`.
For `/api/chat`, validate the passed `sessionId` belongs to the caller before invoking the LLM.

### 2. Replace userId-as-token auth
`authService.ts` issues `token: user.id` — the cookie credential is the raw user UUID. It never
expires, can't be revoked, and the same UUID is stored in every `conversations.user_id` row and
appears in logs. Any leak is a permanent credential.

**Fix:** issue a signed JWT (or an opaque random token stored server-side) with expiry;
add `Secure` flag on the cookie in production; use `cookie-parser` instead of manual
`req.headers.cookie.split(';')` parsing (duplicated in `authMiddleware.ts` and `authRoutes.ts`).

### 3. XSS in chat rendering
`public/js/chat.js` `renderMarkdown()` pipes `marked.parse(text)` straight into `innerHTML`.
LLM output is untrusted (prompt-injectable via repo content, PR diffs, etc.) and marked does
**not** sanitize HTML.

**Fix:** add DOMPurify and sanitize every `innerHTML` assignment of model/markdown content.
Same for `cmd.description` in the command popup.

### 4. Path traversal in file tools
`fileTools.ts` `getFullPath()` does `path.join(workspace, relativePath)` — a `relativePath` of
`../../...` (supplied by the LLM) escapes the workspace. The `CRITICAL_DIRECTORIES` guard is
prefix-based and trivially bypassed the same way. The same pattern likely applies where
`changeSetService.acceptChangeSet` writes accepted files.

**Fix:** `path.resolve` the joined path and reject unless it starts with the resolved
workspace root; apply in read/write/delete/list tools and in changeset accept.

### 5. Supabase RLS policies are wide open
`001_initial_schema.sql` creates `USING (true) WITH CHECK (true)` policies with no `TO` clause —
they apply to **every** role including `anon`. The backend uses a secret key (bypasses RLS
anyway), so these policies only serve to grant the publishable/anon key full read/write on all
tables — including `users.password_hash`.

**Fix:** drop these policies (RLS-enabled tables with no policy deny anon by default), or scope
them `TO service_role` explicitly. Ship as migration `002`.

### 6. Express hardening
- No `helmet`, no rate limiting (`/api/auth/login` is brute-forceable; `/api/chat` burns paid
  LLM quota), no central error-handling middleware, no 404 handler
- `express.static('public')` is CWD-relative — use an absolute path
- `authMiddleware` PUBLIC_PATHS uses `startsWith` matching (e.g. `/api/auth/login-anything`
  would match) — use exact matching or a router-level split

---

## P1 — Correctness bugs

| # | Issue | Location | Status |
|---|-------|----------|--------|
| 1 | Redirects to `/login`, a route that doesn't exist (view route is `/signin`). Unauthed users got there via a lucky double-redirect; a user with a valid cookie hitting the fallback path gets `Cannot GET /login` | `public/js/chat.js` (3 spots) | ✅ **Fixed** |
| 2 | `CONVERSATION_HISTORY_LIMIT` comment said "20 messages" but value is 10 | `src/constants/chatConstants.ts` | ✅ Comment fixed — **decide** if you actually want 20 (comment's original intent) |
| 3 | Session-title race: `recordExchange` is fire-and-forget, so two rapid messages can both see `getConversationCount() === 0` and the title gets overwritten by message 2. Fixed with an atomic conditional update (`setSessionTitleIfEmpty`) | `src/web/routes/apiRoutes.ts`, `sessionRepository.ts` | ✅ **Fixed** |
| 4 | The synchronous count + title update add two DB round trips *after* the LLM response but *before* `res.json` — the conditional-update fix removed both | same | ✅ **Fixed** |
| 5 | History race: exchange N is persisted async, so a rapid message N+1 may build LLM context missing it. Acceptable for now; fixable by persisting the user message before invoking the LLM | `apiRoutes.ts` / `chatService.ts` | Accepted risk — document |
| 6 | 6 of 8 commands advertised in `@` autocomplete had no registered handler → "Unknown command" on use. List now filtered to `commandRegistry.listAll()` | `apiRoutes.ts` | ✅ **Fixed** |
| 7 | `marked.setOptions({ highlight })` did nothing — the option was removed in marked v5 (v15 is loaded). Dead option deleted; highlighting still works via `processCodeBlocks` | `public/js/chat.js` | ✅ **Fixed** |
| 8 | `generateId()` used `Math.random()` for markdown session IDs — replaced with `uuid` and the helper deleted | `src/memory/sessionManager.ts` | ✅ **Fixed** |
| 9 | Dead config branch: `if (authMode === 'pat' && !parsedEnv.GITHUB_TOKEN)` could never be true — removed | `src/config/index.ts` | ✅ **Fixed** |
| 10 | `GET /` returned plain text `Hello NeuroStack` — now redirects `/` → `/app` | `src/web/routes/viewRoutes.ts` | ✅ **Fixed** |

---

## P2 — Architecture decisions (need a call from you)

### 1. LangGraph: wire it or remove it
`src/graph/` (state, workflow, nodes) is **imported by nothing**. README, AGENTS.md, and
`project_architecture_and_plan.md` all describe a LangGraph planner→coder→reviewer engine with
approval interrupts that doesn't run. Either:
- **(a)** Wire the documented workflow into `AgentHandler` (the natural Phase-2 move), or
- **(b)** Delete `src/graph/` and de-scope the docs until you're ready

### 2. Resolve the dual-persistence story
The codebase has two parallel memory systems: markdown context (`src/memory/`, `context/`) and
Supabase. AGENTS.md still says "no database" and the Phase-1 plan says "Markdown-based
persistence only" — both now false. Recommended split: **DB** for users/sessions/conversations,
**markdown** for rules/command templates/learned patterns. Then update README, AGENTS.md, and
the architecture doc to match reality (also remove the WebSocket claim — there's no `ws`
dependency or socket code).

### 3. Centralize LLM invocation with retry/backoff
`logs/error.log` shows repeated Gemini "high demand" failures surfacing straight to users —
there is no retry anywhere. `chatService` and `AgentHandler` duplicate the
create-provider→invoke→stringify pattern. Extract one `llmService` with exponential-backoff
retry (or LangChain's `maxRetries`), a timeout, and a friendly fallback message. Also: create
the provider **once** at bootstrap, not per request.

### 4. Real streaming
The typewriter effect is client-side fake streaming after full response arrival. Gemini via
LangChain supports token streaming — an SSE endpoint would cut perceived latency dramatically
for long responses. Good candidate after the security work lands.

### 5. Complete the command surface
Only `@AGENT` and `@NEW_SESSION` are registered. `gitService`, `githubService`, `gitTools`,
and `githubTools` already exist — the remaining handlers (`@CREATE_PR`, `@PR_REVIEW`,
`@PR_APPROVE`, `@MERGE_PR`, `@AGENT_FIX_CODE`, `@REVIEW`) are mostly wiring. This is the core
product promise of the README.

---

## P3 — Quality infrastructure

1. **Tests (currently zero).** Add `vitest`. Priority order: `commands/parser` (pure, high
   value), `utils/*`, `chatService` with a mocked LLM, repositories with a mocked Supabase
   client, auth + IDOR regression tests via `supertest` (locks in the P0 fixes)
2. **ESLint is not installed** but `npm run lint` exists — the script fails. Add
   `eslint` + `typescript-eslint` (flat config) + `prettier` matching the AGENTS.md formatting
   table, which is currently enforced by nothing
3. **CI:** GitHub Actions running typecheck + lint + tests on PR — fitting for a project whose
   whole purpose is PR workflow automation
4. **LICENSE file is missing** though README links `./LICENSE` (MIT)
5. **Vendor `marked` + `highlight.js` locally** instead of cdnjs (offline dev, supply-chain)
6. **`.env.example`:** verify it documents `SUPA_BASE_PROJECT_URL` / `SUPA_BASE_DB_API_KEY`
   (config hard-requires them; README's env section omits them)

---

## Suggested sequence

| Step | Scope | Outcome |
|------|-------|---------|
| 1 | Commit the in-flight branch (multi-turn context + lazy sessions, with the two fixes applied) | WIP lands clean |
| 2 | **Security sprint:** P0 items 1–5, then 6 | Safe multi-user operation |
| 3 | **Quality floor:** ESLint + vitest + CI + auth/IDOR regression tests | Later work is guarded |
| 4 | P1 leftovers (title race, command-list filter, dead code) | Polish |
| 5 | Architecture calls: LangGraph in/out, persistence story, docs truth-up | Docs match code |
| 6 | LLM service w/ retry + real streaming | UX + resilience |
| 7 | Remaining command handlers (`@CREATE_PR` → `@MERGE_PR`) | Core product complete |
