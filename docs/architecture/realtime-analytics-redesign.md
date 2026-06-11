# Event-Driven Analytics — Architecture & Implementation Plan

> Status: **Proposed** · Author: Engineering · Date: 2026-06-10
> Supersedes the cron-based daily/monthly aggregation model.

---

## 1. Executive Summary

DevAnalytics is already event-driven at the **edge** (webhook → ack <50 ms → async processors → per-commit AI analysis). The problem is **not** ingestion or scoring latency — it is the **aggregation layer**: dashboards read from `DailySummary` / `MonthlySummary`, which are materialised by two cron jobs (`00:30 UTC` daily, `01:00 UTC` monthly). So raw scores are fresh within seconds, but the **numbers a manager sees lag by up to 24 hours**, and they only exist at `developer × day|month` grain — there is no org/project/team/company dimension and no weekly/sprint/custom precomputed view.

This redesign:

1. **Deletes the analysis crons.** Roll-ups become **incrementally recomputed** the moment a fact changes, driven by **MongoDB Change Streams** (no Redis, per the chosen Mongo-only constraint).
2. **Introduces the hierarchy** Organization → Project → Repository → (Work Items / PRs / Commits), plus Team and an implicit Company root, as first-class collections — and stamps every fact with the full hierarchy keys so drill-down is a cheap indexed read.
3. **Makes the platform multi-org.** Each Azure DevOps organization stores its own encrypted PAT (the requested "org → PAT key/value"). A per-org Azure client factory replaces the single global PAT.
4. **Adds the PR ↔ Work-Item effort analysis** you described — AI estimates *expected* time from the PR's real code diff + work-item description, compares it to the developer's *actual* time, and exposes the two-bar "expected vs actual" verdict. It is built as a **re-entrant state machine that tolerates the work item being tagged to the PR after the PR is created.**

Target scale is ≤50 developers / a few orgs / <10k commits/day, so **MongoDB pre-aggregation is sufficient** — no OLAP store. The read model is shaped so an OLAP/columnar layer can be added later without touching the write path.

---

## 2. Current State Assessment

### 2.1 What is already good (keep)
- **Webhook ingestion** (`webhooks.controller.ts`): HMAC-verify → dedupe by delivery id → encrypt payload → persist `WebhookEvent` (PENDING) → `TriggerLog` → emit `webhook.{type}` → always `200 {received:true}` in <50 ms. This contract is correct; keep it.
- **Async processors** (`push-event`, `pull-request`, `work-item`): enrich via Azure API, upsert `Commit` / `PullRequest` / `WorkItem`, defer gracefully on `AzureRateLimitError` via `markRateLimited` (back-off without consuming retry budget).
- **Per-commit AI analysis** is *already* near-real-time: `commit.saved` → LangGraph (`fetch-work-item → analyze-with-qwen → calculate-score → save-analysis`).
- **Late-binding signals already partly exist**: PR processor extracts `workItemRefs` and raises a `NO_WORK_ITEMS` `PrAlert`; work-item processor detects an added PR `ArtifactLink` (`isPrRelation`) and stamps `prLinkedAt`.

### 2.2 What is cron-bound (the actual problem)
| Cron | Schedule | Role | Disposition |
|---|---|---|---|
| `daily-summary.cron` | `30 0 * * *` | Build `developer×day` roll-ups | **Delete** → incremental projector |
| `monthly-summary.cron` | `0 1 1 * *` | Roll day → month | **Delete** → incremental projector |
| `retry-events.cron` | every 5 min | Re-queue stuck/failed webhook events | **Demote** to a low-frequency safety-net sweep behind Change Streams |
| `rotate-logs.cron` | — | Log/Trigger cleanup | **Replace** with Mongo TTL indexes |

### 2.3 Structural gaps vs. the new requirements
1. **No hierarchy entities.** No `Organization`, `Project`, `Repository`, `Team`, `Company`. `Commit`/`PullRequest` carry `projectId`/`repositoryId` as denormalized strings; `WorkItem` carries only `projectName`. **No `organizationId` exists anywhere.**
2. **Single org only.** One global `AZURE_ORG_URL` + `AZURE_PAT` in env; `AzureBoardsService`/`AzureGitService` build one `WebApi` in their constructor. Multi-org is impossible.
3. **Roll-ups are `developer×{day,month}` only.** No company/org/project/team grain. `getOrgOverview` scans the entire `commits` collection unscoped — won't survive multi-org.
4. **No weekly / sprint / custom precomputed views** (computed ad-hoc with a 90-day cap).
5. **Scoring semantics mismatch.** `calculate-score.node.ts` scores *how close the AI estimate was to the work item's manual estimate* — that is planning-accuracy, not the PR-LOC-vs-actual-time efficiency requested.
6. **No real line-level diff.** `AzureGitService.getCommitDiff` is **file-level only** ("Line counts will be 0 for edit/rename entries"). The "2 lines pushed for a 2-hour task" feature needs **real added/removed line counts**, which requires fetching blob content — not currently done. *(See §6.3.)*

---

## 3. Locked Decisions (from stakeholder)

| # | Decision | Consequence |
|---|---|---|
| **Tenancy** | Single, **service-based** company; **one Azure org per client/project** | `Organization` is the natural tenant boundary; "Company" = implicit aggregate over all orgs. No multi-customer isolation needed, but org-scoping is mandatory on every query/index. |
| **Infra** | **Mongo-only** — Change Streams + a Mongo-backed durable queue | No Redis/Kafka. Requires Mongo to run as a **replica set** (single-node RS is fine) for Change Streams. |
| **Scale** | **Small/mid (≤50 devs)** | Incremental **scoped-recompute** roll-ups in Mongo are sufficient. No OLAP. Keep an upgrade seam. |
| **Score** | **Time-efficiency with late binding** | AI derives *expected* hours from PR diff (LOC + complexity) + work-item description; compare to developer *actual* time. Two-bar "expected vs actual" output. PR is created first; work item is tagged later → analysis must re-run on link. |

---

## 4. Target Architecture

### 4.1 Domain hierarchy (new collections)

```
Company (implicit = all orgs)
└── Organization (1 per Azure DevOps org, holds encrypted PAT)
    └── Project
        └── Repository
            ├── Commit
            ├── PullRequest
            └── (WorkItem — project-scoped, not repo-scoped)
    └── Team (orgs' developer groupings)
        └── Developer (azureDevOpsId)
```

New collections:

- **`organizations`** — `azureOrgId`, `name`, `clientName?`, `orgUrl` (`https://dev.azure.com/{org}`), `patEncrypted` (AES-256-GCM via existing `EncryptionService`), `patLast4`, `patAddedByUserId`, `webhookSecret` (per-org HMAC), `isActive`, `lastSyncedAt`. **This is the "org → PAT key/value" store.**
- **`projects`** — `organizationId`, `azureProjectId`, `name`. Unique `(organizationId, azureProjectId)`.
- **`repositories`** — `organizationId`, `projectId`, `azureRepoId`, `name`, `defaultBranch`. Unique `azureRepoId`.
- **`teams`** — `organizationId`, `name`, `azureTeamId?`, `memberAzureIds: string[]`. Powers team-level drill-down (synced from Azure teams or curated).
- **`sprints`** *(iterations)* — `organizationId`, `projectId`, `teamId?`, `name`, `path`, `startDate`, `endDate`. Needed to bound sprint roll-ups by date window.

**Company** is *not* a collection (single company) — it is the synthetic top scope `scopeId="__company__"`. The seam: if the product ever becomes multi-customer, add `companyId` to `organizations` and to the rollup key; nothing else reshapes.

**Fact denormalization (required):** every fact carries the full hierarchy so roll-ups are a narrow indexed `$match`:
- `Commit`, `PullRequest`: **add `organizationId`** (already have `projectId`/`repositoryId`).
- `WorkItem`: **add `organizationId`, `projectId`, `repositoryId?`** (currently only `projectName`).
- All facts also resolve `teamId` (from the developer's team membership) at write time.

### 4.2 Multi-org PAT & Azure client factory

Replace the constructor-built singleton `WebApi` with an injectable **`AzureClientFactory`**:

```
getClient(organizationId) ->
  load Organization -> decrypt PAT -> memoize WebApi(orgUrl, PAT handler)
  + memoize a PER-ORG throttle bucket (each PAT has its own Azure rate budget)
```

- `AzureBoardsService` / `AzureGitService` methods take an `organizationId` (or are resolved per-org from the factory). `getAllOrgMembers`, `resolveUserByEmail`, `getCommitDiff`, etc. all route through the factory.
- **Throttling becomes per-org** (today it is one global bucket) so a busy client org cannot starve another. `AzureThrottleService` is keyed by `organizationId`.
- **Webhook routing carries the org:** Azure webhooks are configured per-org to `POST /webhooks/azure/:orgId`, and HMAC is verified against that org's `webhookSecret`. `WebhookEvent` records `organizationId`. (Inferring org from payload is brittle; the URL is explicit.)
- **Admin UX:** "Add Organization" form (name, orgUrl, PAT) → PAT encrypted at rest, validated by a probe call. "Select organization" in the dashboard scopes every subsequent view.

### 4.3 Event pipeline — Mongo-only, near-real-time

**Principle:** keep the fast edge; make the downstream **durable, decoupled, and resumable** with Change Streams, and replace cron aggregation with an incremental projector.

```
Azure webhook
  │  POST /webhooks/azure/:orgId   (<50ms ack — unchanged)
  ▼
webhook_events (PENDING)  ──emit webhook.{type} (in-proc, hot path)──┐
  │                                                                  │
  │  Change Stream watch(webhook_events)                             ▼
  ▼                                                            Processors
EventDispatcher (durable, resumable) ──claims PENDING──►  push / PR / work-item
  ▲                                                                  │
  └── reconciliation sweep (safety net, ~1–2 min)                    │ upsert facts
                                                                     ▼
                                          commits / pull_requests / work_items / ai_analysis
                                                                     │
                                          Change Stream watch(fact collections)
                                                                     ▼
                                                       RollupProjector (idempotent)
                                                                     │ scoped recompute
                                                                     ▼
                                                         analytics_rollups (the cube)
                                                                     ▲
                                                          Dashboard reads (instant)
```

Key mechanisms:

- **`EventDispatcher`** — a Change-Stream consumer on `webhook_events` reacts to inserts within milliseconds and claims each event atomically (`findOneAndUpdate status PENDING→PROCESSING`, the pattern already in `retry-events.cron`). The in-process `EventEmitter2` emit stays as a latency hint when healthy. A **reconciliation sweep** (every 1–2 min, *not* analysis) re-claims anything missed during a restart/outage — this replaces `retry-events.cron`'s role.
- **`RollupProjector`** — Change-Stream consumer on `commits` / `pull_requests` / `work_items` / `pr_effort_analysis`. For each change it computes the **set of buckets touched** (developer/team/project/org/company × day/week/month/sprint) and **recomputes only those buckets** by a narrow scoped aggregation from source facts.
  - **Idempotent by construction:** recompute-from-source is naturally safe under Change-Stream redelivery and out-of-order/late events — no fragile `$inc` deltas, no double counting, self-healing.
  - **Resumable:** persist the resume token in `stream_checkpoints` so a restart continues exactly where it stopped (no missed updates, no full rescan).
  - **Single active consumer** via a Mongo leader-lock doc (one projector at a time); at this scale one process suffices.

**Replica-set requirement (must-flag):** Change Streams require Mongo to run as a replica set. Atlas provides this; self-hosted standalone must be converted to a **single-node replica set** (a one-line config change). **Fallback** if RS is unavailable: a poll-based projector that scans a `dirty_buckets` queue the processors write to — same read model, slightly higher latency.

### 4.4 The multi-grain rollup cube (replaces both summary collections)

A single generalized collection serves every drill-down and every time window:

**`analytics_rollups`**
| Field | Purpose |
|---|---|
| `scopeType` | `company` \| `org` \| `project` \| `team` \| `developer` |
| `scopeId` | id at that scope (`__company__`, organizationId, projectId, teamId, developerAzureId) |
| `organizationId`, `projectId`, `teamId`, `developerAzureId` | denormalized parents (nullable) → enables "all projects under org O", "all devs under project P" |
| `periodType` | `day` \| `week` \| `month` \| `sprint` |
| `periodKey` | `2026-06-10` \| `2026-W24` \| `2026-06` \| `<sprintPath>` |
| `periodStart`, `periodEnd` | Date bounds (range + custom-range queries) |
| metrics | `totalCommits, totalLinesAdded, totalLinesRemoved, totalFilesChanged, repositoriesWorkedOn[], prCreated, prMerged, prCompleted, workItemsCompleted, avgEfficiencyScore, aiExpectedHours, developerActualHours, avgEffortDeltaPercent, …` |
| `updatedAt` | last projection time |

- **Unique index** `(scopeType, scopeId, periodType, periodKey)`.
- **Drill-down indexes** e.g. `(organizationId, periodType, periodKey, scopeType)`, `(projectId, periodType, periodKey)`.
- **Day/week/month/sprint are all first-class precomputed periods.**
- **Custom date range** = sum the `day` rollups across `[from,to]` for the scope (≤366 docs/scope/year — trivial). No ad-hoc full scans, no 90-day cap.
- Replaces `DailySummary` + `MonthlySummary`. Migrate by backfilling from existing facts; keep old collections briefly for a parity check, then drop.

**Why scoped-recompute is affordable here:** one commit touches ~20 buckets (5 scopes × 4 periods). Each recompute is a tiny `$match`-bounded aggregation. At <10k commits/day this is comfortable for Mongo. **Upgrade seam:** if volume ever 10×s, swap the projector internals to incremental `$inc` + a processed-event ledger — the cube shape and all read APIs stay identical.

### 4.5 PR ↔ Work-Item effort analysis (late-binding state machine)

This is the headline product feature. It is **PR-grained** (not commit-grained) and **re-entrant**, because the PR exists before the work item is linked.

**New collection `pr_effort_analysis`** (keyed by `azurePrId`, upserted):
- Identity: `organizationId, projectId, repositoryId, azurePrId, authorAzureId, workItemIds[]`
- **Phase 1 — code-derived** (on PR created/updated): `totalLinesAdded, totalLinesRemoved, filesChanged, languages, complexityLevel, aiExpectedHoursMin, aiExpectedHoursMax, workSubstanceScore, aiCodeReviewSummary`
- **Phase 2 — work-item-derived** (on link): `workItemEstimatedHours` (OriginalEstimate), `workItemActualHours` (CompletedWork), `developerActualHours` (work-item `activatedAt→closedAt`, fallback PR `firstCommit→merge`), `workItemDescriptionSummary`
- **Phase 3 — verdict** (both present): `headlineExpectedHours`, `headlineActualHours`, `expectedVsActualDeltaPercent`, `efficiencyScore`, `efficiencyVerdict` (`over-allocated|aligned|under-allocated`), `explanation`
- Control: `analysisPhase: code_only | linked | complete`, `modelUsed`, timestamps

**State machine:**

```
git.pullrequest.created/updated
        │  (NO work item required yet)
        ▼
  Phase 1: fetch PR aggregate diff (REAL line counts, §6.3),
           AI expected-time range from code + PR title/description
        │   analysisPhase = code_only   ──►  dashboard can already show the "expected" bar
        ▼
  work item tagged later  ── detected via ──►  pr.workitem.linked
        │   (work-item processor isPrRelation/prLinkedAt
        │    OR PR update workItemRefs OR getPrLinkedWorkItems reconcile)
        ▼
  Phase 2: fetch work item description + estimate + actual time
        │   analysisPhase = linked
        ▼
  work item closed / PR merged
        ▼
  Phase 3: compute developerActualHours, verdict, score, explanation
            analysisPhase = complete   ──► two-bar chart + AI explanation
```

- **Idempotent & convergent:** every phase upserts by `azurePrId`; re-running on additional pushes, the link event, or close is safe. The analysis is *not* one-shot — it converges as facts arrive. This directly answers "the work item won't be added at first… think in a broader manner."
- **Reconciliation:** a PR stuck in `code_only` past a threshold with no link triggers a `getPrLinkedWorkItems` check (covers links Azure didn't webhook).
- Writing `pr_effort_analysis` is itself a fact change → the `RollupProjector` folds `aiExpectedHours` / `developerActualHours` into the cube at every scope.

### 4.6 Scoring model

**Headline = time efficiency** (the requested model):

```
expectedMid = (aiExpectedHoursMin + aiExpectedHoursMax) / 2
actual      = developerActualHours
efficiencyScore = clamp(0..100, round(100 * expectedMid / max(actual, expectedMid)))
verdict:
  actual <= aiExpectedHoursMax * 1.25  -> aligned
  actual >  aiExpectedHoursMax * 1.25  -> over-allocated  (2h spent on a 50-min job)
  actual <  aiExpectedHoursMin * 0.75  -> under-allocated  (suspiciously fast / under-scoped)
```

- **Two-bar frontend output:** Bar A = `headlineExpectedHours` (AI, e.g. "≤50 min"); Bar B = `developerActualHours` (e.g. "2h") + the AI `explanation`.
- The old estimate-accuracy number is retained as a **secondary "planning accuracy"** signal, not the headline.
- **Fairness guardrails (product-critical):** suppress/flag the score for tiny diffs, research/spike work items, docs-only PRs, and long-lived PRs with idle gaps; surface it as a *signal with explanation*, never an unexplained verdict on a person. The formula is a tunable, documented in one place.

### 4.7 Read / API layer (instant drill-down)

All analytics endpoints read **only** from `analytics_rollups` / `pr_effort_analysis` — never scan fact collections:

- `GET /analytics/overview?scope=&scopeId=&period=&periodKey=`
- `GET /analytics/timeseries?scope=&scopeId=&metric=&from=&to=` (sums `day` rollups)
- `GET /analytics/drilldown?parentScope=org&parentId=&childScope=project&period=&periodKey=` (ranked children)
- `GET /analytics/pr/:azurePrId/effort` (two-bar verdict + explanation)
- `GET /analytics/developer/:azureId/effort?from=&to=`
- Existing developer/commit endpoints stay, re-scoped by `organizationId`.

### 4.8 Cron disposition (final)

- ❌ `daily-summary.cron` — **deleted**; logic refactored into idempotent `RollupService.recomputeBucket()` (also exposed as an admin backfill/repair endpoint, unscheduled).
- ❌ `monthly-summary.cron` — **deleted**; month is just another `periodType`.
- 🔁 `retry-events.cron` — **replaced** by the Change-Stream `EventDispatcher` + a 1–2 min reconciliation sweep (reliability, not analysis).
- 🔁 `rotate-logs.cron` — **replaced** by Mongo **TTL indexes** on `webhook_events` / `trigger_logs`.

**Result: zero analysis crons.** Remaining scheduled work is a lightweight reliability sweep + optional metadata refresh (sprint boundaries), neither of which performs analysis or scoring.

---

## 5. Scalability & the upgrade seams

- **Today (≤50 devs):** scoped-recompute roll-ups, single projector process. Comfortable.
- **Seam 1 — throughput:** projector switches from recompute-from-source to incremental `$inc` + event ledger. Read model unchanged.
- **Seam 2 — OLAP:** if cross-cutting ad-hoc analytics are ever needed, add a columnar store fed from the same Change Streams; `analytics_rollups` remains the serving layer.
- **Seam 3 — multi-customer SaaS:** add `companyId` to `organizations` + rollup key; tenant-scope guards on queries.
- **Seam 4 — horizontal processing:** partition Change Streams by `organizationId` across N workers (leader-lock per partition).

---

## 6. Risks & mitigations

1. **Change Streams need a replica set.** → Convert standalone Mongo to single-node RS (trivial) or use Atlas. Fallback: poll a `dirty_buckets` queue. *(Decision needed at deploy time — see §9.)*
2. **Double counting under stream redelivery.** → Mitigated by recompute-from-source idempotency; resume tokens persisted.
3. **PAT secret sprawl / leakage.** → Encrypted at rest (existing `EncryptionService`), `patLast4` only in responses, never logged; per-org webhook secret.
4. **Per-org Azure rate limits.** → Per-org throttle buckets; existing `AzureRateLimitError`/`markRateLimited` back-off preserved.
5. **(Critical) No real line counts today.** → `getCommitDiff` is file-level. **§6.3** adds a real-diff path for the effort feature.
6. **Sprint boundaries** aren't webhook-driven. → Small `sprints` metadata sync (lazy on unknown iteration, or low-frequency refresh) — metadata, not analysis.
7. **Effort scoring is people-sensitive.** → Guardrails in §4.6; ship as explained signal, calibrate against history (§7).

### 6.3 Real line-level diff (enabler for the effort feature)
The effort analysis needs true added/removed lines, which Azure's change-list API does not give. Add `AzureGitService.getPrAggregateDiff(orgId, repoId, prId)`:
- Resolve the PR's base and head commits (PR iterations API).
- For each changed **text** file (skip binaries/lockfiles/generated paths by extension+size cap), fetch base and head blob content and compute a line-level diff (e.g. `diff` over bounded content).
- Aggregate `linesAdded/linesRemoved/filesChanged` for the PR; cap total files/bytes to bound cost; cache per PR-iteration.
- This runs **once per PR analysis** (not per commit) so cost stays bounded, and feeds both Phase 1 and the cube.

---

## 7. Acceptance-criteria mapping

| Acceptance criterion | Covered by |
|---|---|
| AI retrieves & analyzes Azure commits | Existing push pipeline + §6.3 real diff |
| AI associates commits with work items | PR↔WorkItem late-binding (§4.5) |
| AI estimates effort from commit history & code complexity | Phase 1 code analysis (§4.5/§4.6) |
| AI provides an effort score + explanation | Phase 3 verdict + `explanation` (§4.6) |
| Results viewable in dashboard/report | Two-bar effort view + drill-down APIs (§4.7) |
| Accuracy validated against historical data | **Calibration backtest**: run analyzer over historical PRs+work items, compare AI-expected vs known-actual, report calibration error; tune formula before rollout |
| Near-real-time, no cron dependency | Change-Stream projector (§4.3/§4.8) |
| Multi-org per company | Hierarchy + per-org PAT factory (§4.1/§4.2) |
| Company/org/project/team/developer drill-down | `analytics_rollups` cube (§4.4) |
| Daily/weekly/monthly/sprint/custom history | `periodType` + day-rollup summation (§4.4) |
| Scales without major rearchitecture | Upgrade seams (§5) |

---

## 8. Phased implementation plan

Each chunk ships independently with the existing verification gate: backend `pnpm build` + `tsc` + `pnpm test` green, frontend `tsc` + `pnpm build` green.

- **Chunk A — Hierarchy & multi-org foundation**
  `organizations` (+encrypted PAT) / `projects` / `repositories` / `teams` schemas; `AzureClientFactory` + per-org throttle; per-org webhook route `/:orgId` + per-org HMAC; stamp `organizationId` on facts; admin "Add/Select Organization" API. *No behavior change to analytics yet.*
- **Chunk B — Mongo replica set + Change-Stream plumbing**
  Confirm/convert RS; `stream_checkpoints`, leader-lock; `EventDispatcher` on `webhook_events`; demote `retry-events.cron` to reconciliation sweep; TTL indexes replace `rotate-logs.cron`.
- **Chunk C — Rollup cube + projector (deletes the analysis crons)**
  `analytics_rollups` schema+indexes; `RollupService.recomputeBucket()` (idempotent, refactored from `daily-summary` logic); `RollupProjector` on fact collections; backfill from existing data; parity-check vs `DailySummary`/`MonthlySummary`; **delete both summary crons**; repoint analytics read APIs to the cube.
- **Chunk D — Real diff + PR effort state machine**
  `getPrAggregateDiff` (§6.3); `pr_effort_analysis` schema; Phase 1/2/3 handlers wired to PR + work-item-link events; reconciliation for unlinked PRs; effort + drill-down read APIs.
- **Chunk E — Scoring, calibration & frontend**
  Time-efficiency score + guardrails; historical calibration backtest + tuning; two-bar effort view + company/org/project/team/developer drill-down + weekly/sprint/custom selectors in the Next.js dashboard.
- **Chunk F — Cleanup**
  Drop legacy `DailySummary`/`MonthlySummary` after parity window; remove dead `src/auth/*`, `src/users/*` clusters if in scope; docs + runbook (RS setup, projector ops, backfill/repair).

---

## 9. Open questions (non-blocking, resolve before/within the relevant chunk)
1. **Mongo deployment:** Atlas vs self-hosted? If self-hosted standalone, are we cleared to convert to a single-node replica set (needed for Change Streams in Chunk B)?
2. **Team source of truth:** sync teams from Azure DevOps teams, or curate manually in-app?
3. **"Developer actual time":** primary source — work-item `Activated→Closed`, work-item `CompletedWork`, or PR `firstCommit→merge`? (Plan uses Activated→Closed with PR-window fallback.)
4. **PAT scope/rotation:** required Azure scopes (Code read, Work Items read, Project read) and a rotation/expiry reminder policy.
5. **Effort-score visibility:** is the per-developer efficiency verdict shown to developers, or managers-only initially? (Affects guardrail strictness.)
6. **Add created and updated time in every mongodb collection for each entry**