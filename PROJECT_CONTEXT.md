# PROJECT_CONTEXT

> AI context primer for **DevAnalytics** (a.k.a. Work-Flow-Analyst). Read this before making
> changes so you can act without re-scanning the whole repo. When code and this doc disagree,
> the code wins — update this file if you change something structural.

---

## 1. What this application does

DevAnalytics is a **developer-productivity analytics platform for Azure DevOps teams**. It ingests
Azure DevOps events (git pushes, pull requests, work-item updates) via webhooks, runs **AI-powered
analysis** on each commit and pull request (effort estimation, efficiency scoring, complexity), and
aggregates everything into per-developer / per-org daily & monthly summaries surfaced through a REST
API and a Next.js dashboard.

It answers: _"What did my engineering team actually ship, and how efficiently — estimated vs actual effort?"_

## 2. Main business purpose

The company is **service-based**: each client engagement maps to its own Azure DevOps organization.
DevAnalytics is an **internal management tool** for admins/managers to:
- Track commit/PR/work-item activity per developer, repository, project, and organization.
- Compare AI-**estimated** effort against **actual** effort (work-item logged hours or commit-session time) to spot variance.
- Surface process gaps (e.g. PRs with no linked work items) and monitor login/usage.

Developers are **subjects of analysis, not users of the system** — they never log in.

## 3. Tech stack

**Backend** (`/src`)
- NestJS v10 on **Fastify** (`@nestjs/platform-fastify`), TypeScript (strict, ESM-style imports).
- MongoDB via **Mongoose** (`@nestjs/mongoose`).
- **LangChain + LangGraph** (`@langchain/langgraph`, `@langchain/openai`, `@langchain/community`) for AI. Provider-pluggable: openai / anthropic / qwen / alibaba / custom (default model `gpt-4o`, configurable).
- `@nestjs/event-emitter` (EventEmitter2, wildcard events) for async in-process pipelines.
- `@nestjs/schedule` for cron jobs.
- `azure-devops-node-api` for outbound Azure calls.
- Auth: `@nestjs/passport` + `passport-jwt` + `@nestjs/jwt`, `bcryptjs`.
- Validation: `class-validator` / `class-transformer` (DTOs) + **Joi** (env schema).
- Security: `@fastify/helmet`. Config: `@nestjs/config`. API docs: `@nestjs/swagger` (decorators present; setup may be partial).

**Frontend** (`/frontend`)
- **Next.js 15** (App Router), React 18, TypeScript.
- **NextAuth v4** (CredentialsProvider) for session; **Zustand** for client auth/UI state; **TanStack Query** for server state.
- **shadcn/ui + Radix UI + Tailwind CSS**; charts via **ApexCharts** (`react-apexcharts`) + `react-calendar-heatmap`.
- `axios` API client with silent JWT refresh; `react-hook-form` + `zod`.

**Tooling**: pnpm (monorepo-ish, separate installs per package), ESLint + Prettier, Jest (backend `*.spec.ts`), PM2 (`ecosystem.config.js`). Node version pinned in `.nvmrc`.

## 4. High-level architecture

```
Azure DevOps ──webhook POST──▶ NestJS/Fastify (api/v1)
                                  │
                    WebhooksController (always 200, <50ms)
                      • dedupe • encrypt raw payload • persist WebhookEvent + TriggerLog
                      • emit `webhook.<type>` (EventEmitter2)
                                  │ (async, decoupled)
        ┌─────────────────────────┼───────────────────────────────┐
   PushEventProcessor      PullRequestProcessor            WorkItemProcessor
   → Commit docs           → PullRequest + PrAlert docs    → WorkItem docs
   emits `commit.saved`    emits `analysis.pr.changed`     emits `analysis.workitem.changed`
        │                          │                               │
   AIAnalysisService          PrEffortService (pr-effort module) ◀─┘
   (LangGraph per commit)     (AI estimate + actual + variance, upsert PrEffortAnalysis)
        │
   AIAnalysis docs
        │
   Cron jobs (nightly): DailySummary (00:30 UTC), MonthlySummary (1st 01:00 UTC)
        │
   AnalyticsService (read models) ──▶ AnalyticsController (REST) ──▶ Next.js dashboard
```

Key principles:
- **Webhook ack path is fast and never fails**: the controller swallows all errors and always returns `{received:true}` (Azure retries any non-2xx → flood). Heavy work happens asynchronously via events.
- **Event-driven, decoupled processing**: webhook → DB → emit event → processor → emit downstream event. Processors are idempotent and swallow/log their own errors.
- **Precomputed read models**: `DailySummary`, `MonthlySummary`, `PrEffortAnalysis` are projections built by crons/processors so dashboard reads are single indexed queries.
- **Multi-tenant by Azure organization** (`Organization` = tenant boundary). Each org stores its own encrypted PAT.

## 5. Important modules and responsibilities

Backend feature modules live under `src/modules/`. Infra under `src/common`, `src/shared`, `src/database`, `src/config`. **Note:** the active Auth/Users code is in `src/modules/auth` and `src/modules/users`; the legacy `src/auth` and `src/users` mostly survive only for the User **schema** (`@app/users/schemas/user.schema`) which is still imported widely.

| Module | Path | Responsibility |
|---|---|---|
| App | `src/app.module.ts` | Wires config (Joi-validated env), Mongoose, EventEmitter2, Schedule, and all feature modules. Registers two global `APP_GUARD`s: `JwtAuthGuard` then `RolesGuard`. |
| Bootstrap | `src/main.ts` | Fastify adapter, CORS, global `api/v1` prefix, global `ValidationPipe`, custom JSON content-type parser that stashes `rawBody` (for webhook HMAC), Helmet. |
| Auth | `src/modules/auth` | Login (bcrypt, account lockout after 5 fails, whitelist check), JWT access+refresh with **rotation**, logout, login-event recording. |
| Users | `src/modules/users` | Portal user CRUD/profile, sanitization, avatar (binary in Mongo). |
| Organizations | `src/modules/organizations` | CRUD for connected Azure orgs; encrypts/validates PATs (probe call before save); `POST /:id/sync` imports Projects → Repositories → Teams (+members). Owns per-org Azure client resolution. **Admin-only.** |
| Webhooks | `src/modules/webhooks` | Single ingestion endpoint + 3 event processors (`push`, `pr.*`, `workitem.*`) + `CommitsService`. Persists Commit/PullRequest/WorkItem/PrAlert and emits downstream events. |
| AI Analysis | `src/modules/ai-analysis` | LangGraph state machine that analyzes each commit (`commit.saved` → score + effort estimate → `AIAnalysis`). Contains `langgraph/` (graph + nodes + state) and `langchain/` (LLM provider, prompts, JSON parsing). |
| PR Effort | `src/modules/pr-effort` | Computes per-PR estimated-vs-actual effort (`PrEffortAnalysis`). AI estimate (cached/stable) + actual from work-item logged hours or **commit-session** active-time algorithm; handles late-binding when a work item is linked after the PR. |
| Analytics | `src/modules/analytics` | Read API (`AnalyticsController`/`Service`) over the precomputed summaries, plus all **crons** (`crons/`). |
| Developers | `src/modules/developers` | The `developers` collection (non-auth identities). `findOrCreateFromCommit`, azureId→displayName maps. |
| Shared/Azure | `src/shared/azure` | `AzureClientFactory` (per-org cached clients), `AzureThrottleService` (concurrency + rate pacing + 429 cooldown + retry), `AzureGitService`, `AzureBoardsService`, `AzureRateLimitError`. |
| Shared/Encryption | `src/shared/encryption` | AES-256-GCM `EncryptionService` (key = SHA-256 of `ENCRYPTION_KEY`). Encrypts PATs and raw webhook payloads at rest. |
| Common | `src/common` | Guards (`JwtAuthGuard`, `RolesGuard`), decorators (`@Public`, `@Roles`, `@CurrentUser`), filters, interceptors (logging/timeout/transform), middlewares, shared types (`UserRole`, `PaginatedResult`, `ApiResponse`). |

**Frontend** (`frontend/src`): App Router with `(auth)` (signin) and `(protected)` route groups (`dashboard`, `analytics/daily`, `analytics/monthly`, `developer/[id]`, `settings`). `lib/api-client.ts` (axios + refresh), `lib/auth.config.ts` (NextAuth), `store/` (Zustand), `hooks/` (TanStack Query data hooks), `components/` (charts, dashboard, developer, layout, ui).

## 6. Database and major entities

MongoDB; all schemas in `src/database/schemas/` and registered in `DatabaseModule` (`MongooseModule.forFeature`). All use `{ timestamps: true }` (createdAt/updatedAt). Secrets use `select:false` and are stripped in `toJSON`.

| Collection | Purpose / key fields |
|---|---|
| `User` | Portal user. `email`, `emailHash` (unique), `passwordHash`, `role` (admin/manager), `isWhitelisted`, `refreshTokenHash`, lockout fields. Secrets stripped in `toJSON`. |
| `Developer` | Non-auth engineer identity resolved from commit author. `azureDevOpsId`, name/email. |
| `Organization` | Tenant. `orgUrl` (unique), `azureOrgSlug`, `patEncrypted` (select:false), `patLast4`, `webhookSecret` (select:false), `isActive`, `lastSyncedAt`. |
| `Project` / `Repository` / `Team` | Azure hierarchy imported via org sync. `organizationId` FK; repos by `azureRepoId`; teams hold `memberAzureIds`. |
| `Commit` | `azureCommitId` (unique), repo/project, `authorAzureId`, `filesChanged[]`, line/file totals, `languagesUsed`, `pullRequestId` (Mongo id of PR, back-linked), `workItemIds[]`, `analysisStatus`. Indexed on `(authorAzureId, pushedAt)`. |
| `PullRequest` | `azurePrId`, status (active/completed/abandoned/draft), branches, `authorAzureId`, `commitIds`, `workItemIds`, reviewers, `mergedAt`/`completedAt`. |
| `WorkItem` | `azureWorkItemId`, type/state, `assignedToAzureId`, estimate/completed/remaining hours, story points, sprint, `closedAt`, `cycleTimeDays`, `leadTimeDays`, `prLinkedAt`. |
| `AIAnalysis` | Per-commit AI result: `commitId` FK, `efficiencyScore`, `complexityLevel`, `technicalSummary`, `estimatedEffortHours`, `actualEffortHours`, `effortDeltaPercent`. |
| `PrEffortAnalysis` | Per-PR projection: estimated min/max/mid hours, `complexityLevel`, `aiExplanation`, `actualHours`+`actualSource`, `variancePercent`, `phase`, `activeDates[]` (day-keys), `commitCount`, `lastCommitAt`. |
| `DailySummary` / `MonthlySummary` | Per-developer rollups keyed by `(developerAzureId, date|month)`. Commits, lines, repos, `avgEfficiencyScore`, est/actual hours, prCreated/Merged, workItemsCompleted. |
| `WebhookEvent` | Raw ingest record: `azureDeliveryId` (dedupe), `eventType`, `rawPayload` (encrypted, select:false), `status` (pending/processing/processed/failed), `retryCount`, `nextRetryAt`. |
| `TriggerLog` | Audit of each delivery (developer/repo/project/IP, processing status). |
| `LoginEvent` | Append-only login record for admin login analytics (`userId`, `date`, `ipAddress`). |
| `PrAlert` | PRs flagged (e.g. `NO_WORK_ITEMS`). |
| `Sprint` | Sprint/iteration data. |

## 7. External integrations & third-party services

- **Azure DevOps** (primary). Inbound: webhooks (push, PR, work item). Outbound via `azure-devops-node-api`: commit diffs (Git API), work-item details (Boards/WIT API), org hierarchy sync (Core + Git APIs). All outbound calls go through `AzureThrottleService`. Each org authenticates with its **own encrypted PAT**.
- **LLM providers** via LangChain: OpenAI / Anthropic / Qwen / Alibaba (DashScope) / custom base URL. Selected by `AI_MODEL_PROVIDER`; key resolved from the matching `*_API_KEY`.
- **MongoDB** as datastore.
- No external queue/cache service (Redis etc.) — event bus is **in-process** EventEmitter2; retries are DB-backed via cron.

## 8. Authentication & authorization

- **Backend**: stateless JWT. `JwtAuthGuard` is a **global** guard — every route requires a valid access token unless decorated `@Public()` (e.g. the webhook endpoint). `RolesGuard` is global too — routes opt in with `@Roles(UserRole.ADMIN, ...)`. Roles are only **`admin`** and **`manager`** (see `common/types/roles.enum.ts`); developers are not users. (Some docs/comments mention a "developer" role — that is stale.)
- **Tokens**: access (`JWT_SECRET`, default 15m) + refresh (`JWT_REFRESH_SECRET`, default 7d). Refresh tokens are **rotated** on use and stored hashed (`refreshTokenHash`). Login enforces whitelist + account lockout (5 attempts → 15 min lock).
- **Frontend**: NextAuth CredentialsProvider calls the backend login; tokens kept in Zustand; `api-client.ts` auto-refreshes on 401. `middleware.ts` gates all non-public routes (redirect to `/signin`).
- **Secrets at rest**: org PATs and raw webhook payloads encrypted with AES-256-GCM (`EncryptionService`). Changing `ENCRYPTION_KEY` invalidates previously-encrypted PATs.
- **Webhook auth**: ingestion is `@Public()`; `main.ts` stashes `rawBody` and `Organization.webhookSecret` exists to support per-org **HMAC** verification. Verify current state in `webhooks.controller.ts` before assuming signatures are enforced (a `validators/` folder exists for this).

## 9. Background jobs, schedulers, queues, event processing

**Event bus (in-process, EventEmitter2, wildcard `.` delimiter)** — see `app.module.ts`:
- `webhook.push` → `PushEventProcessor` → emits `commit.saved`
- `webhook.pr.*` → `PullRequestProcessor` → emits `analysis.pr.changed`
- `webhook.workitem.created|updated` → `WorkItemProcessor` → emits `analysis.workitem.changed`
- `commit.saved` → `AIAnalysisService.handleCommitSaved` (runs LangGraph)
- `analysis.pr.changed` → `PrEffortProcessor.onPrChanged` → `PrEffortService.computeForPr`
- `analysis.workitem.changed` → `PrEffortProcessor.onWorkItemChanged` → recompute linked PRs
Handlers use `@OnEvent(..., { async: true })` and swallow/log errors so one failure never blocks the pipeline.

**Crons** (`src/modules/analytics/crons/`, `@nestjs/schedule`):
- `daily-summary.cron.ts` — **00:30 UTC** daily; aggregates yesterday's commits/PRs/work-items + AI scores → `DailySummary` (bulk upsert). Has `isRunning` guard; also exposed on-demand via `POST /analytics/admin/trigger-daily` (409 if running).
- `monthly-summary.cron.ts` — monthly rollup → `MonthlySummary`.
- `retry-events.cron.ts` — **every 5 min**; re-queues stuck `PENDING` (>2 min) or `FAILED` (`retryCount < 3`) webhook events; respects `nextRetryAt` back-off; claims each event atomically via conditional `findOneAndUpdate` to avoid double-processing.
- `rotate-logs.cron.ts` — log/data housekeeping.

**Rate limiting**: `AzureThrottleService` bounds concurrency + paces requests + global cooldown on 429/503. A persistent rate-limit surfaces as `AzureRateLimitError`; processors catch it and call `webhooksService.markRateLimited(id, retryAfterMs)` (defers without consuming retry budget) so the retry cron reprocesses later.

## 10. Key data flows

**A. Commit → AI analysis → summaries**
1. Azure `git.push` → `POST /api/v1/webhooks/azure`. Dedupe by delivery id; encrypt+store `WebhookEvent`; log `TriggerLog`; emit `webhook.push`; return 200.
2. `PushEventProcessor`: decrypt payload, fetch diff (throttled Azure Git API), parse, `findOrCreate` developer, persist `Commit`, emit `commit.saved`.
3. `AIAnalysisService`: LangGraph `extractCommitInfo → fetchWorkItem → analyzeWithQwen → calculateScore → saveAnalysis` → writes `AIAnalysis`.
4. Nightly `DailySummaryCron` aggregates commits + joined `AIAnalysis` + PR/work-item counts → `DailySummary`; monthly cron rolls up.
5. Dashboard reads via `AnalyticsController`.

**B. PR effort (estimated vs actual, with late binding)**
1. `git.pullrequest.*` → `PullRequestProcessor` upserts `PullRequest`, raises `PrAlert` if no work items, back-links commits, emits `analysis.pr.changed`.
2. `PrEffortService.computeForPr`: aggregate commit stats → AI estimate (reused if already computed) → actual = work-item `CompletedWork` else commit-session active time (`estimateActiveHoursFromCommits`, 120-min session gap, 30-min lead-in, 40h cap) → variance + phase → upsert `PrEffortAnalysis`.
3. When a work item is later linked/closed (`workitem.updated`), `WorkItemProcessor` emits `analysis.workitem.changed` → recompute every linked PR's actual/variance.

**C. Organization onboarding**: admin `POST /organizations` (PAT probed + encrypted) → `POST /organizations/:id/sync` imports Projects/Repositories/Teams via throttled Azure calls.

**D. Auth**: login → tokens (access+refresh, refresh hashed) + `LoginEvent`; frontend stores tokens, auto-refreshes on 401 with rotation.

## 11. Coding patterns & conventions

- **NestJS DI everywhere**: feature modules import `DatabaseModule`/`SharedModule`; models injected via `@InjectModel(X.name)`.
- **Path alias `@app/*` → `src/*`** (tsconfig). Use it for backend imports. Frontend uses `@/*` → `frontend/src/*`.
- **Schemas**: `@Schema({ timestamps: true })`, `declare` field props, exported `XDocument = HydratedDocument<X>` + `XSchema`. Secrets `select:false` + stripped in `toJSON` (which also maps `_id`→`id`, drops `__v`). Add indexes explicitly after `SchemaFactory.createForClass`.
- **Validation**: request DTOs in each module's `dto/` with class-validator; global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`). Env validated by Joi in `app.module.ts` (add new env vars there).
- **Read vs write models**: never compute heavy analytics on the read path — extend a cron/processor projection instead.
- **Resilience contract**: webhook controller and all `@OnEvent` processors must never throw to the caller — catch, log via `Logger`, update status. Azure rate limits use `AzureRateLimitError` + `markRateLimited`, not generic failure.
- **Idempotency**: dedupe webhooks by `azureDeliveryId`; processors guard with `exists()` / upserts keyed by Azure ids (`azureCommitId`, `azurePrId`, `azureWorkItemId`).
- **AI calls**: prompts in `ai-analysis/langchain/prompts/`; always have a deterministic fallback (e.g. `heuristicEstimate`) and tolerant JSON parsing — LLM output is never trusted to be valid JSON.
- **Identity model**: analytics key off **`azureDevOpsId`** (developers), resolved to display names via `DevelopersService`. Don't assume a developer has a `User`.
- **Dates**: analytics buckets are **UTC** `YYYY-MM-DD` / `YYYY-MM` strings; helpers in services and `src/shared/helpers/date.helper.ts`.
- **API shape**: responses wrapped as `{ success, data }` by a transform interceptor; lists use `PaginatedResult<T>` (`items,total,page,totalPages`). Global prefix `api/v1`.
- **Route ordering caveat**: literal routes (e.g. `analytics/prs/alerts`) are declared **before** `:param` routes to avoid wildcard capture.
- **Logging**: `new Logger(ClassName.name)`; debug for flow, warn for recoverable, error with stack.

## 12. Repo layout quick map

```
src/
  app.module.ts, main.ts
  config/        app|database|jwt|azure|ai .config.ts (+ Joi schema in app.module)
  common/        guards, decorators, filters, interceptors, middlewares, types
  shared/        azure/ (client factory, throttle, git/boards services), encryption/, helpers/, interfaces/
  database/      database.module.ts, schemas/ (17 schemas + index.ts)
  modules/       auth, users, organizations, webhooks, ai-analysis, pr-effort, analytics, developers
  scripts/       seed-admin.ts (pnpm seed:admin)
frontend/src/    app/ (App Router), components/, hooks/, lib/, store/, types/, middleware.ts
docs/architecture/   design docs & roadmap (e.g. realtime-analytics-redesign.md)
scripts/seed-dummy-data.mjs   local data seeding
```

## 13. Gotchas / things to verify before changing

- **Duplicated auth/users trees**: prefer `src/modules/auth` & `src/modules/users` (wired in `AppModule`). The User **schema** still lives at `src/users/schemas/user.schema.ts` and is imported via `@app/users/schemas/user.schema` — don't delete it blindly.
- **Stale docs**: `README.md` mentions a `developer` role and ECharts; the actual roles are admin/manager only and charts use **ApexCharts**. Trust the code.
- **Multi-org migration in progress** (`WHATS-NEW.md`): legacy single-org env vars (`AZURE_ORG_URL`, `AZURE_PAT`, `AZURE_WEBHOOK_SECRET`) are still required by Joi even though per-org PATs exist; webhook routing may not yet be fully per-org. Check before assuming full tenancy.
- **Encryption key stability**: never rotate `ENCRYPTION_KEY` without re-entering all org PATs.
- **Two ports**: backend `3000` (`/api/v1`), frontend `3001` (`next dev --port 3001`); `FRONTEND_URL` drives CORS.
```
