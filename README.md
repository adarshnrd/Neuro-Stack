# DevAnalytics

A full-stack developer productivity analytics platform for Azure DevOps teams. DevAnalytics ingests push events, pull-request events, and work-item updates from Azure DevOps via webhooks, runs an AI-powered efficiency analysis on each commit using LangChain/LangGraph, and exposes the aggregated metrics through a REST API consumed by a Next.js dashboard.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [Architecture](#3-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Prerequisites](#5-prerequisites)
6. [Environment Variables](#6-environment-variables)
7. [Installation](#7-installation)
8. [Database Setup](#8-database-setup)
9. [Build Process](#9-build-process)
10. [Starting the Servers](#10-starting-the-servers)
11. [Development Workflow](#11-development-workflow)
12. [Available Scripts](#12-available-scripts)
13. [API Reference](#13-api-reference)
14. [Authentication and Roles](#14-authentication-and-roles)
15. [Azure DevOps Webhook Setup](#15-azure-devops-webhook-setup)
16. [Scheduled Cron Jobs](#16-scheduled-cron-jobs)
17. [Testing](#17-testing)
18. [Production Deployment with PM2](#18-production-deployment-with-pm2)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. Project Overview

DevAnalytics is an internal tool that answers the question: _"What did my engineering team actually ship today, and how efficiently?"_

Data flows in through Azure DevOps webhooks → gets stored in MongoDB → an AI graph (LangChain + LangGraph) analyses each commit and scores it → nightly cron jobs aggregate the scores into daily and monthly summaries → the Next.js frontend visualises everything in real-time.

**Tech stack at a glance**

| Layer | Technology |
|---|---|
| Backend API | NestJS v10, Fastify, TypeScript |
| Database | MongoDB via Mongoose |
| AI / LLM | LangChain, LangGraph, Qwen/OpenAI/Anthropic |
| Azure integration | `azure-devops-node-api` |
| Frontend | Next.js 15 (App Router), TypeScript |
| UI components | shadcn/ui, Radix UI, Tailwind CSS |
| Charts | Apache ECharts via `echarts-for-react` |
| Auth (frontend) | NextAuth v4 (CredentialsProvider) |
| Auth (backend) | Passport JWT, refresh-token rotation |
| State management | Zustand + TanStack Query |
| Package manager | pnpm |

---

## 2. Key Features

- **Webhook ingestion** — A single `POST /api/v1/webhooks/azure` endpoint accepts all Azure DevOps event types (git push, pull-request, work-item updates). Every payload is HMAC-verified, deduplicated, encrypted at rest, and acknowledged in under 50 ms.
- **AI commit analysis** — A LangGraph state machine triggers automatically after each push: it fetches the commit diff, retrieves linked work items, runs an LLM prompt to estimate effort, compute an efficiency score (0–100), and identify the complexity level.
- **Daily summaries** — A cron job at 00:30 UTC aggregates the previous day's commits, PRs, work items, and AI scores into a per-developer `DailySummary` document.
- **Monthly roll-ups** — A cron job at 01:00 UTC on the 1st of each month rolls up daily summaries into `MonthlySummary` documents.
- **Analytics REST API** — Org-level overview, per-developer daily/monthly/commit/project endpoints, and PR alert endpoints (PRs with no linked work items).
- **Role-based access control** — Three roles: `admin`, `manager`, `developer`. Developers can only view their own data. Managers and admins see everyone.
- **Retry resilience** — Failed or stale webhook events are automatically re-queued every 5 minutes (up to 3 retries per event).
- **Interactive dashboard** — KPI cards, team comparison chart, activity feed, sortable daily/monthly tables with CSV export, individual developer profile pages with commit timeline, heatmap, and efficiency gauge.

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Azure DevOps                                                     │
│  (webhooks for push / PR / work-item events)                      │
└────────────────────────────┬──────────────────────────────────────┘
                             │ HTTPS POST (HMAC-signed)
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│  NestJS + Fastify Backend  (port 3000)                            │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Auth     │  │ Users    │  │ Webhooks     │  │ Analytics   │  │
│  │ Module   │  │ Module   │  │ Module       │  │ Module      │  │
│  └──────────┘  └──────────┘  └──────┬───────┘  └─────────────┘  │
│                                      │ EventEmitter2             │
│                              ┌───────▼────────┐                  │
│                              │ AI Analysis    │                  │
│                              │ Module         │                  │
│                              │ (LangGraph)    │                  │
│                              └───────┬────────┘                  │
│                                      │                           │
│  ┌───────────────────────────────────▼──────────────────────┐   │
│  │  MongoDB (Mongoose)                                        │   │
│  │  users · commits · pull_requests · work_items             │   │
│  │  webhook_events · trigger_logs · ai_analyses              │   │
│  │  daily_summaries · monthly_summaries · pr_alerts          │   │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                             │ REST API  /api/v1
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│  Next.js 15 Frontend  (port 3001)                                 │
│  Dashboard · Daily Analytics · Monthly Analytics · Dev Profile    │
└───────────────────────────────────────────────────────────────────┘
```

**Request lifecycle (webhook)**

1. Azure DevOps POST → `WebhooksController`
2. `WebhookHmacGuard` verifies HMAC-SHA256 signature
3. Duplicate delivery check (idempotency via `deliveryId`)
4. Raw payload encrypted and saved as `WebhookEvent`
5. `TriggerLog` audit record written
6. `EventEmitter2` fires `webhook.<eventType>` (non-blocking)
7. HTTP 200 `{received:true}` returned to Azure (< 50 ms target)
8. Async processor handles the event (push → save `Commit`, emit `commit.saved`)
9. `AIAnalysisService` picks up `commit.saved`, runs the LangGraph pipeline

---

## 4. Folder Structure

```
Work-Flow-Analyst/                  ← monorepo root
├── src/                            ← Backend source (NestJS)
│   ├── main.ts                     ← Fastify bootstrap, CORS, global pipes
│   ├── app.module.ts               ← Root module, global guards, config validation
│   ├── config/                     ← Typed config factories (app, db, jwt, azure, ai)
│   ├── database/
│   │   ├── database.module.ts
│   │   └── schemas/                ← All Mongoose schemas
│   │       ├── user.schema.ts
│   │       ├── commit.schema.ts
│   │       ├── pull-request.schema.ts
│   │       ├── work-item.schema.ts
│   │       ├── webhook-event.schema.ts
│   │       ├── trigger-log.schema.ts
│   │       ├── ai-analysis.schema.ts
│   │       ├── daily-summary.schema.ts
│   │       └── monthly-summary.schema.ts
│   ├── common/                     ← Cross-cutting concerns (guards, filters, interceptors)
│   │   ├── decorators/             ← @Public(), @CurrentUser(), @Roles()
│   │   ├── guards/                 ← JwtAuthGuard, RolesGuard, WebhookHmacGuard
│   │   ├── filters/                ← Global exception filters
│   │   └── interceptors/           ← Logging, timeout, response-transform
│   ├── shared/                     ← Shared services used across feature modules
│   │   ├── azure/                  ← AzureGitService, AzureBoardsService
│   │   ├── encryption/             ← AES-256-GCM encryption service
│   │   ├── hmac/                   ← HMAC validator
│   │   └── helpers/                ← Date helpers, diff parser
│   ├── modules/                    ← Feature modules
│   │   ├── auth/                   ← JWT auth, login, register, refresh, logout
│   │   ├── users/                  ← User CRUD, whitelist, Azure sync
│   │   ├── webhooks/               ← Ingestion endpoint, processors, HMAC
│   │   ├── analytics/              ← REST endpoints, daily/monthly cron jobs
│   │   └── ai-analysis/            ← LangGraph pipeline, LLM provider
│   │       ├── langchain/          ← Prompts, JSON parser, LLM provider factory
│   │       └── langgraph/          ← Graph definition, nodes, state
│   └── scripts/
│       └── seed-admin.ts           ← One-time admin bootstrap script
├── dist/                           ← Compiled output (git-ignored in production)
├── ecosystem.config.js             ← PM2 production config
├── tsconfig.json
├── nest-cli.json
├── .env                            ← Local secrets (never commit)
├── .env.example                    ← Template — copy to .env
│
└── frontend/                       ← Next.js frontend
    ├── src/
    │   ├── app/                    ← App Router pages
    │   │   ├── (auth)/signin/      ← Login page (public)
    │   │   ├── (protected)/        ← Authenticated shell
    │   │   │   ├── dashboard/      ← KPI + team chart + activity feed
    │   │   │   ├── analytics/daily/
    │   │   │   ├── analytics/monthly/
    │   │   │   └── developer/[id]/ ← Individual developer profile
    │   │   └── api/auth/           ← NextAuth route handler
    │   ├── components/
    │   │   ├── charts/             ← ECharts wrappers
    │   │   ├── dashboard/          ← KpiCard, RecentActivityFeed, etc.
    │   │   ├── developer/          ← CommitTimeline, DeveloperCard, etc.
    │   │   ├── layout/             ← Sidebar, TopHeader
    │   │   └── ui/                 ← shadcn/ui base components
    │   ├── hooks/                  ← TanStack Query hooks
    │   ├── lib/                    ← Auth config, API client, utils
    │   ├── store/                  ← Zustand stores
    │   ├── types/                  ← Shared TypeScript types
    │   └── middleware.ts           ← NextAuth route protection
    ├── .env.local                  ← Local frontend secrets (never commit)
    ├── .env.local.example          ← Template — copy to .env.local
    ├── next.config.ts
    └── tailwind.config.ts
```

---

## 5. Prerequisites

Ensure the following are installed before you begin.

| Requirement | Minimum version | Check |
|---|---|---|
| Node.js | 20.x (LTS) | `node -v` |
| pnpm | 8.9.x | `pnpm -v` |
| MongoDB | 6.x (local or Atlas) | `mongod --version` |
| Git | any | `git --version` |

> **Node version management** — Both the backend and `frontend/` ship an `.nvmrc` file pinning Node 20. If you use `nvm`, run `nvm use` in each directory to activate the correct version automatically.

**Optional / AI providers**

At least one of the following API keys is needed for the AI analysis pipeline. The pipeline is non-blocking; the platform runs without it, but commits will never receive an efficiency score.

- OpenAI API key (`sk-...`) when `AI_MODEL_PROVIDER=openai`
- Alibaba DashScope key for Qwen models when `AI_MODEL_PROVIDER=qwen` or `alibaba`
- Anthropic API key when `AI_MODEL_PROVIDER=anthropic`

---

## 6. Environment Variables

### Backend — `.env`

Copy `.env.example` to `.env` and fill in every value.

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | Runtime environment (`development` / `production` / `test`) |
| `PORT` | no | `3000` | Port the NestJS server listens on |
| `HOST` | no | `0.0.0.0` | Bind address |
| `FRONTEND_URL` | **yes** | — | Full URL of the Next.js frontend (e.g. `http://localhost:3001`). Used for CORS allow-list. |
| `MONGODB_URI` | **yes** | — | MongoDB connection string (e.g. `mongodb://localhost:27017`) |
| `MONGODB_DB_NAME` | no | `dev_analytics` | Target database name |
| `JWT_SECRET` | **yes** | — | Secret for signing access tokens. Minimum 32 characters. |
| `JWT_EXPIRATION` | no | `15m` | Access token TTL (e.g. `15m`, `1h`, `7d`) |
| `JWT_REFRESH_SECRET` | **yes** | — | Secret for signing refresh tokens. Must differ from `JWT_SECRET`. Minimum 32 characters. |
| `JWT_REFRESH_EXPIRATION` | no | `7d` | Refresh token TTL |
| `ENCRYPTION_KEY` | **yes** | — | Key for AES-256-GCM encryption of stored payloads and user display names. Minimum 16 characters. |
| `AZURE_ORG_URL` | **yes** | — | Your Azure DevOps organisation URL, e.g. `https://dev.azure.com/my-org` |
| `AZURE_PAT` | **yes** | — | Azure DevOps Personal Access Token with read scopes for Code, Work Items |
| `AZURE_WEBHOOK_SECRET` | **yes** | — | Shared secret configured in the Azure DevOps webhook settings (used for HMAC verification) |
| `OPENAI_API_KEY` | no | — | OpenAI API key. Required when `AI_MODEL_PROVIDER=openai` (default) |
| `ANTHROPIC_API_KEY` | no | — | Anthropic API key. Required when `AI_MODEL_PROVIDER=anthropic` |
| `ALIBABA_API_KEY` | no | — | Alibaba DashScope key. Required when `AI_MODEL_PROVIDER=qwen` or `alibaba` |
| `AI_MODEL_PROVIDER` | no | `openai` | LLM backend: `openai` / `anthropic` / `qwen` / `alibaba` / `custom` |
| `AI_MODEL_NAME` | no | `qwen-plus` | Model identifier passed to the provider |
| `AI_TEMPERATURE` | no | `0.1` | LLM sampling temperature (0–2) |
| `AI_CUSTOM_BASE_URL` | no | — | Base URL for an OpenAI-compatible local endpoint (e.g. LM Studio, Ollama) |

**Generating secure secrets**

```bash
# Generate a 48-character random secret (works on macOS and Linux)
openssl rand -base64 36
```

---

### Frontend — `frontend/.env.local`

```bash
cp frontend/.env.local.example frontend/.env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | Public URL of the NestJS backend, reachable from the browser (e.g. `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | **yes** | Secret for NextAuth session signing. Minimum 32 characters. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | **yes** | Full URL where the Next.js app is served (e.g. `http://localhost:3001`). Required in production. |
| `INTERNAL_API_URL` | **yes** | Server-side URL used by NextAuth's CredentialsProvider to call the backend. In Docker Compose this is typically the container service name (e.g. `http://api:3000`). In local dev it is the same as `NEXT_PUBLIC_API_URL`. |

---

## 7. Installation

The project is a monorepo where the backend and frontend each manage their own dependencies. Install them separately.

### Step 1 — Clone the repository

```bash
git clone <repository-url> Work-Flow-Analyst
cd Work-Flow-Analyst
```

### Step 2 — Install backend dependencies

```bash
# In the repo root
pnpm install
```

### Step 3 — Install frontend dependencies

```bash
cd frontend
pnpm install
cd ..
```

### Step 4 — Configure environment variables

```bash
# Backend
cp .env.example .env
# Edit .env and fill in all required values

# Frontend
cp frontend/.env.local.example frontend/.env.local
# Edit frontend/.env.local and fill in all required values
```

---

## 8. Database Setup

DevAnalytics uses MongoDB with Mongoose. There are **no migration files** — Mongoose creates collections and indexes automatically the first time the application starts.

### Start MongoDB locally

```bash
# macOS with Homebrew
brew services start mongodb-community

# Or run a Docker container
docker run -d --name mongo -p 27017:27017 mongo:7
```

Set `MONGODB_URI=mongodb://localhost:27017` and `MONGODB_DB_NAME=dev_analytics` in your `.env`.

### Seed the first admin user

The database starts empty. You must create an admin account before you can log in to the frontend. Run the seed script once:

```bash
pnpm seed:admin -- --email admin@example.com --password "YourStrongPassword1" --name "Admin User"
```

- The script is idempotent — running it again with the same email is safe and does nothing.
- The `--name` flag is optional (defaults to the email local-part).
- Requires `MONGODB_URI`, `MONGODB_DB_NAME`, and `ENCRYPTION_KEY` to be set in `.env`.

### MongoDB collections created automatically

| Collection | Purpose |
|---|---|
| `users` | Registered users with hashed passwords and encrypted display names |
| `commits` | Git push events parsed from Azure webhooks |
| `pull_requests` | PR events from Azure webhooks |
| `work_items` | Work item updates from Azure webhooks |
| `webhook_events` | Raw encrypted webhook payloads (audit trail) |
| `trigger_logs` | Audit log for every webhook delivery attempt |
| `ai_analyses` | LLM-generated efficiency scores and effort estimates per commit |
| `daily_summaries` | Per-developer aggregated daily metrics |
| `monthly_summaries` | Per-developer aggregated monthly metrics |

---

## 9. Build Process

### Do you need to build before starting?

| Mode | Build required? |
|---|---|
| Development (backend) | **No** — `pnpm start:dev` compiles on-the-fly with ts-node + watch |
| Development (frontend) | **No** — `pnpm dev` uses the Next.js dev server with hot-reload |
| Production (backend) | **Yes** — run `pnpm build` first, then `node dist/main` |
| Production (frontend) | **Yes** — run `pnpm build` inside `frontend/`, then `pnpm start` |

### Build the backend

```bash
# In repo root
pnpm build
# Output: dist/
```

### Build the frontend

```bash
cd frontend
pnpm build
# Output: frontend/.next/
```

---

## 10. Starting the Servers

### Development

Open two terminal tabs — one for the backend, one for the frontend.

**Terminal 1 — Backend**

```bash
# In repo root
pnpm start:dev
```

The backend starts on `http://localhost:3000`. The API is accessible at `http://localhost:3000/api/v1`.

The server logs each request and prints `DevAnalytics API listening on http://0.0.0.0:3000/api/v1` when ready.

**Terminal 2 — Frontend**

```bash
cd frontend
pnpm dev
```

The frontend starts on `http://localhost:3001` (Next.js dev server).

Open `http://localhost:3001` in your browser. You will be redirected to `/signin`. Use the admin credentials you seeded in step 8.

### Production

Build both applications first (see section 9), then:

**Backend**

```bash
node dist/main
```

Or via PM2 (recommended — see section 18):

```bash
pm2 start ecosystem.config.js --env production
```

**Frontend**

```bash
cd frontend
pnpm start
```

---

## 11. Development Workflow

### Adding a new backend module

1. Create `src/modules/<name>/<name>.module.ts`, `.service.ts`, `.controller.ts`.
2. All routes are JWT-protected by default via the global `JwtAuthGuard`. Mark public routes with `@Public()`.
3. Use `@Roles(UserRole.ADMIN)` on routes that require elevated access.
4. Inject `ConfigService` for reading environment variables — never read `process.env` directly.
5. Register the new module in `src/app.module.ts`.

### Authentication pattern

```typescript
// Mark a route as unauthenticated (skips JWT guard)
@Public()
@Post('webhook')
handleWebhook() { ... }

// Require a specific role (stacked on top of JWT guard)
@Roles(UserRole.ADMIN)
@Get('admin-only')
adminRoute() { ... }

// Access the logged-in user in any protected route
@Get('me')
getProfile(@CurrentUser() user: UserDocument) { ... }
```

### Adding a new frontend page

Pages live under `frontend/src/app/(protected)/`. Create a `page.tsx` file in the appropriate directory — it is automatically protected by the `ProtectedLayout` which verifies the NextAuth session server-side and redirects to `/signin` if the user is unauthenticated.

### Code style

Both workspaces use ESLint + Prettier. Run before committing:

```bash
# Backend
pnpm lint:fix
pnpm format

# Frontend
cd frontend
pnpm lint:fix
pnpm format
```

TypeScript strict mode is enabled. Run a type check with:

```bash
# Backend
pnpm type:check

# Frontend
cd frontend
pnpm type:check
```

---

## 12. Available Scripts

### Backend (run from repo root)

| Script | Command | Description |
|---|---|---|
| Dev server | `pnpm start:dev` | Start with file-watching and hot-reload |
| Debug server | `pnpm start:debug` | Start with Node inspector attached |
| Production server | `pnpm start:prod` | Run compiled `dist/main.js` |
| Build | `pnpm build` | Compile TypeScript to `dist/` |
| Unit tests | `pnpm test` | Run all `*.spec.ts` files with Jest |
| Tests (watch) | `pnpm test:watch` | Re-run tests on file change |
| Coverage | `pnpm test:cov` | Generate coverage report in `coverage/` |
| E2E tests | `pnpm test:e2e` | Run `test/jest-e2e.json` suite |
| Seed admin | `pnpm seed:admin` | Create the first admin user (see section 8) |
| Type check | `pnpm type:check` | `tsc --noEmit` without emitting files |
| Lint | `pnpm lint` | ESLint check |
| Lint (fix) | `pnpm lint:fix` | ESLint auto-fix |
| Format | `pnpm format` | Prettier write |

### Frontend (run from `frontend/`)

| Script | Command | Description |
|---|---|---|
| Dev server | `pnpm dev` | Next.js dev server with hot-reload |
| Build | `pnpm build` | Production build to `.next/` |
| Production server | `pnpm start` | Serve the production build |
| Lint | `pnpm lint` | ESLint + Next.js lint rules |
| Lint (fix) | `pnpm lint:fix` | Auto-fix |
| Format | `pnpm format` | Prettier write for `src/**` |
| Type check | `pnpm type:check` | `tsc --noEmit` |
| Add shadcn/ui components | `pnpm shadcn:add` | Install a preset list of UI components |

---

## 13. API Reference

All backend endpoints are prefixed with `/api/v1`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a new user |
| POST | `/auth/login` | Public | Log in, receive `accessToken` + `refreshToken` |
| POST | `/auth/refresh` | Refresh token | Rotate tokens |
| POST | `/auth/logout` | JWT | Invalidate refresh token |

### Users

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/users/whitelist` | Admin | Pre-whitelist a user email |
| DELETE | `/users/whitelist/:emailHash` | Admin | Remove from whitelist |
| GET | `/users` | Admin, Manager | Paginated user list |
| GET | `/users/:azureId` | Own or Admin/Manager | Get user by Azure ID |
| POST | `/users/sync-azure` | Admin | Sync users from Azure DevOps |
| POST | `/users/change-password` | Authenticated | Change own password |

### Analytics

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/analytics/org/overview?date=YYYY-MM-DD` | All | Org KPIs for a day (defaults to today) |
| GET | `/analytics/org/daily?date=YYYY-MM-DD` | All | All developers' daily summaries for a day |
| GET | `/analytics/org/monthly?month=YYYY-MM` | All | All developers' monthly summaries |
| GET | `/analytics/developer/:azureId/daily` | Own or Admin/Manager | Paginated daily summaries (max 90-day range) |
| GET | `/analytics/developer/:azureId/monthly` | Own or Admin/Manager | Paginated monthly summaries |
| GET | `/analytics/developer/:azureId/commits` | Own or Admin/Manager | Paginated commits with AI analysis |
| GET | `/analytics/developer/:azureId/projects` | Own or Admin/Manager | Repo breakdown |
| GET | `/analytics/prs/alerts` | Admin, Manager | PRs with no linked work items |
| GET | `/analytics/trigger-logs` | Admin | Paginated webhook trigger audit logs |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/azure` | HMAC only | Ingest all Azure DevOps webhook events |

---

## 14. Authentication and Roles

### How authentication works

1. Client `POST /api/v1/auth/login` with `{email, password}`.
2. Backend returns `{accessToken, refreshToken, user}`.
3. Client stores the access token and sends it as `Authorization: Bearer <token>` on every subsequent request.
4. Access tokens expire (default `15m`). When expired, the client calls `POST /api/v1/auth/refresh` with the refresh token in the `Authorization` header to get a new pair.
5. `POST /api/v1/auth/logout` nullifies the stored refresh-token hash.

On the **frontend**, NextAuth manages the session transparently. The `CredentialsProvider` calls the backend login endpoint and stores the tokens in the encrypted NextAuth session cookie.

### Roles

| Role | Capabilities |
|---|---|
| `admin` | Full access. Manage users, view all analytics, see trigger logs, sync Azure DevOps. |
| `manager` | View all developers' analytics and PR alerts. Cannot manage users or see trigger logs. |
| `developer` | View only their own commits, daily/monthly summaries, and profile. |

Roles are enforced:
- **Backend** — globally via `JwtAuthGuard` (requires a valid JWT) + `RolesGuard` (checks `@Roles(...)` metadata).
- **Frontend** — via Next.js middleware (`middleware.ts`) which reads the NextAuth session token and redirects developers away from admin paths.

---

## 15. Azure DevOps Webhook Setup

DevAnalytics receives real-time events from Azure DevOps. Follow these steps to connect them.

### Step 1 — Expose your backend to the internet

In development, use a tunnelling tool such as `ngrok`:

```bash
ngrok http 3000
# Gives you: https://abc123.ngrok-free.app
```

In production, your server must have a publicly reachable URL with HTTPS.

### Step 2 — Create a shared secret

Generate a random secret string (at least 32 characters) and add it to your `.env`:

```
AZURE_WEBHOOK_SECRET=your-generated-secret-here
```

### Step 3 — Configure webhooks in Azure DevOps

1. In your Azure DevOps project, go to **Project Settings → Service hooks**.
2. Click **+** (Create subscription) and select **Web Hooks**.
3. For the event type, select one of the following (repeat for each):
   - **Code pushed** (`git.push`)
   - **Pull request created** (`git.pullrequest.created`)
   - **Pull request updated** (`git.pullrequest.updated`)
   - **Pull request merged** (`git.pullrequest.merged`)
   - **Work item updated** (`workitem.updated`)
4. Set the **URL** to: `https://<your-domain>/api/v1/webhooks/azure`
5. Set the **Shared secret** to the value of `AZURE_WEBHOOK_SECRET`.
6. Azure signs payloads with `HMAC-SHA256`. The backend verifies this in the `WebhookHmacGuard`.

### Step 4 — Verify

After saving, Azure will send a test payload. In the backend logs you should see:

```
[WebhooksController] Received Azure webhook event: git.push
```

---

## 16. Scheduled Cron Jobs

The backend runs four cron jobs. They require no configuration beyond the environment variables already described.

| Job | Schedule | Description |
|---|---|---|
| Daily Summary | `00:30 UTC` every day | Aggregates yesterday's commits, PRs, and work items into `DailySummary` documents |
| Monthly Summary | `01:00 UTC` on the 1st | Rolls up the previous month's daily summaries into `MonthlySummary` |
| Retry Stuck Events | Every 5 minutes | Re-queues webhook events that are stale (pending > 2 min) or failed (< 3 retries) |
| Rotate Logs | Configurable | Prunes old trigger log records |

Cron jobs run within the same NestJS process — no external queue or worker process is required.

---

## 17. Testing

Tests are located alongside the source files and follow the `*.spec.ts` naming convention. The test environment uses Jest + ts-jest. No real database connection is required — all external dependencies are mocked.

### Run all unit tests

```bash
pnpm test
```

### Run in watch mode (re-runs on save)

```bash
pnpm test:watch
```

### Generate a coverage report

```bash
pnpm test:cov
# Report written to coverage/lcov-report/index.html
```

### Run end-to-end tests

```bash
pnpm test:e2e
```

E2E tests use the config in `test/jest-e2e.json`.

---

## 18. Production Deployment with PM2

`ecosystem.config.js` is provided for PM2-based deployments. PM2 runs the compiled backend in cluster mode, spawning one worker per CPU core.

### Install PM2 globally

```bash
npm install -g pm2
```

### Build and start

```bash
# 1. Set all required environment variables in your shell or via your secrets manager.
#    PM2 does NOT load .env files — variables must be in the process environment.
export NODE_ENV=production
export PORT=3000
export MONGODB_URI=mongodb://...
# ... all other required variables

# 2. Build the backend
pnpm build

# 3. Start with PM2
pm2 start ecosystem.config.js --env production

# 4. Persist the process list across reboots
pm2 save
pm2 startup
```

### Useful PM2 commands

```bash
pm2 list                         # Show all processes and their status
pm2 logs dev-analytics-api       # Tail logs in real time
pm2 restart dev-analytics-api    # Graceful restart (zero-downtime in cluster mode)
pm2 stop dev-analytics-api       # Stop the app
pm2 delete dev-analytics-api     # Remove from PM2 process list
```

Log files are written to `./logs/out.log` and `./logs/error.log`.

### Frontend in production

For the Next.js frontend in production, run it behind a reverse proxy (nginx / Caddy):

```bash
cd frontend
pnpm build
pnpm start          # Starts on port 3001 by default
```

Or add a second PM2 app entry in `ecosystem.config.js` for the frontend process.

---

## 19. Troubleshooting

### Server fails to start — "validation error"

The backend validates every required environment variable on startup using Joi. If a variable is missing or invalid, the process exits immediately and logs the problem. Check that your `.env` file is complete and that all required fields are filled in (see section 6).

### `MongoDB connection timed out`

- Ensure MongoDB is running: `mongod` (local) or check your Atlas cluster status.
- Verify `MONGODB_URI` in `.env` points to the correct host/port.
- Check that firewall or network rules are not blocking port `27017`.

### `JWT_SECRET must be at least 32 characters`

Generate a longer secret:

```bash
openssl rand -base64 36
```

### Webhook deliveries fail — "Webhook signature verification failed"

- Confirm that `AZURE_WEBHOOK_SECRET` in `.env` exactly matches the **Shared secret** field in your Azure DevOps webhook subscription (no extra whitespace).
- The backend requires the **raw request body buffer** for HMAC calculation. If your reverse proxy re-encodes or re-compresses the body, the signature check will fail.

### AI analysis never runs — commits stay `pending`

- Check that at least one LLM API key is set and matches `AI_MODEL_PROVIDER`.
- Look in the backend logs for errors from `AIAnalysisService`.
- The AI pipeline is triggered by the `commit.saved` event. Confirm that the push processor is saving commits (look for `CommitsService` log lines after a git push).

### Frontend shows "Unauthorized" after login

- Make sure `NEXTAUTH_SECRET` is set in `frontend/.env.local`.
- Verify `NEXTAUTH_URL` matches the URL you are actually visiting (including port).
- Confirm `INTERNAL_API_URL` is reachable from the Next.js server process, not just the browser.
- Clear browser cookies and try again.

### `NEXT_PUBLIC_API_URL is not defined`

This variable must be set **before** running `pnpm build` because Next.js inlines `NEXT_PUBLIC_*` variables at build time. Set it in `frontend/.env.local` and rebuild.

### pnpm command not found

```bash
npm install -g pnpm@8
```

### Port 3000 already in use

```bash
lsof -ti:3000 | xargs kill -9   # macOS / Linux
```

Or change `PORT` in `.env` and update `NEXT_PUBLIC_API_URL` in the frontend accordingly.

---

## Quick-start Cheatsheet

```bash
# 1. Install dependencies
pnpm install
cd frontend && pnpm install && cd ..

# 2. Configure environment
cp .env.example .env                                    # fill in .env
cp frontend/.env.local.example frontend/.env.local      # fill in .env.local

# 3. Start MongoDB (example: Docker)
docker run -d --name mongo -p 27017:27017 mongo:7

# 4. Create the first admin user
pnpm seed:admin -- --email you@example.com --password "Pass123!"

# 5. Start both servers (two terminals)
pnpm start:dev                 # backend  → http://localhost:3000/api/v1
cd frontend && pnpm dev        # frontend → http://localhost:3001
```
