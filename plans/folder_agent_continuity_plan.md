# NeuroStack — Folder-Scoped Autonomous Agent with Cross-Model Continuity

> Architecture + phased plan for the "Open Folder → describe → `@agent-looping` → never stops"
> workflow. Written as a **delta** against what NeuroStack already has, not greenfield.
> Revised 2026-07-19 per three directives: **(1) no automatic git** — VCS is manual/opt-in only;
> **(2) Claude-Code-style autonomy** — the agent runs whatever terminal commands it needs with no
> per-command approval; **(3) recovery via a plain filesystem state store**, not git checkpoints.

---

## 0. TL;DR — what the work actually is

The engine (plan → execute → validate → fix → repeat) already exists in this repo. Under the new
directives the build reduces to four things:

1. **Folder scoping + direct-apply.** Make the workspace a *selected directory* (not the global
   `config.workspace.path`) and write **directly into it** — the folder-agent workflow applies
   changes in place, unlike today's stage-for-review flow.
2. **Autonomous terminal execution.** A general `run_command` tool the agent drives itself —
   install deps, build, run tests, fix, re-run — **no per-command approval**, scoped to the
   selected folder. This is the one genuinely new capability.
3. **Filesystem state store (`.neurostack/`).** Durable, resumable progress tracking on disk —
   the recovery/continuity mechanism. **No git involvement of any kind** in the automatic loop.
4. **Cross-model handoff.** On limit exhaustion: drain → summarize to disk → advance the model →
   resume from the filesystem state. Continuity survives exhaustion, process exit, and "resume
   tomorrow."

Explicitly **out of the automatic loop**: git commit, branch, push, stash — the system never
touches version control. Git stays 100% manual (a user-run command only).

---

## 1. What already exists (reuse, don't rebuild)

| Capability | NeuroStack today | Status for this feature |
|---|---|---|
| Agent loop (plan→implement→verify→review→judge→rework) | `src/graph/loopWorkflow.ts` | ✅ Reuse the loop shape |
| Model router + fallback chains | `modelRouter.ts`, `roleChains.ts`, `invokeForRole` | ✅ Reuse; extend to session-level failover |
| ReAct tool loop | `src/llm/agentLoop.ts` | ✅ Reuse; bind new `run_command` tool |
| Sandboxed checks (tsc/test/lint/syntax) | `verificationService.ts` | ◑ Keep for staged-review flow; folder-agent validates **in place** instead |
| Task spec / criteria | `taskSpecService.ts` | ◑ Extend flat criteria → dependency graph |
| Path containment guard | `resolveInsideRoot` (fileUtil) | ✅ Reuse verbatim as the folder sandbox |
| Write-context plumbing | `changeSetContext` (AsyncLocalStorage) | ✅ Same pattern for `WorkspaceContext` |
| Loop checkpointing | LangGraph `MemorySaver` (in-memory) | ✗ Replace with durable filesystem saver |
| Direct file writes | staged into changesets | ✗ Add direct-apply mode |
| General shell execution | only allowlisted checks in a sandbox | ✗ Add autonomous `run_command` |
| Folder selection / `.neurostack/` / handoff | — | ✗ New |

**Net:** engine reused wholesale; the new build is folder scoping, autonomous shell, the
filesystem state store, and the handoff protocol.

---

## 2. Two operating modes (they coexist)

NeuroStack keeps its current **staged-review** mode (`@AGENT`, `@AGENT_LOOP` on the configured
workspace: changes staged into changesets, human reviews, sandboxed verification). The new
workflow is a second mode:

**Folder-agent mode (`@agent-looping <folder-or-prompt>`)** — direct-apply, autonomous:
- Writes changes straight into the selected folder (transactional writes).
- Runs terminal commands itself in that folder, no per-command approval.
- Validates **in place** (runs the project's real build/test), not in a sandbox copy.
- Tracks progress in `.neurostack/`; recoverable via `resume`.
- Never touches git.

Mode is a property of the `WorkspaceSession`, so the same loop graph serves both — only the
write path, validation target, and tool set differ.

---

## 3. Target architecture (delta view)

```
  Entry: "Open Folder" (web picker)  OR  CLI `neurostack <folder>`
                     │  select rootDir → validate → open/create .neurostack/
                     ▼
        ┌─────────────────────────────┐
        │  WorkspaceSession            │  NEW — per-run, folder-scoped; replaces the
        │  { rootDir, mode: direct,    │        single global workspace.path
        │    projectMap, model chain } │
        └──────────────┬──────────────┘
                       ▼
        ┌─────────────────────────────┐
        │  Agent Loop (existing graph) │  REUSE — plan → execute → validate → fix → repeat
        └──────────────┬──────────────┘
        WorkspaceContext │ (AsyncLocalStorage: rootDir + mode)
                       ▼
        ┌───────────────┬───────────────┐
        │ file tools    │ run_command    │  file tools write in place (transactional);
        │ (direct write)│ (autonomous    │  run_command executes shell in rootDir with
        │               │  shell in cwd) │  NO per-command approval
        └──────────────┬────────────────┘
                       ▼
        ┌─────────────────────────────┐
        │  Filesystem State Store      │  NEW — .neurostack/: plan.json, progress-log.jsonl,
        │  (durable checkpointer)      │        context-summary.md, decisions.md, open-issues.md,
        │  NO GIT                      │        snapshots/ (optional file-level undo)
        └──────────────┬──────────────┘
                       ▼
        ┌─────────────────────────────┐
        │  ContinuityManager           │  NEW — limit signals → drain → summarize to disk →
        │  (cross-model handoff)       │        advance model chain → resume from state store
        └─────────────────────────────┘
```

Design decisions worth calling out:

- **Recovery = filesystem state store, not git.** Per directive (3), continuity is a durable
  LangGraph `BaseCheckpointSaver` backed by `.neurostack/checkpoints/`, projected into
  human-readable `.md`/`.jsonl` files. Git is never read or written by the loop.
- **Autonomy over gating.** Per directive (2), normal dev commands run without approval. The only
  retained guard is a **narrow, configurable denylist** for irreversible catastrophe
  (`rm -rf /`, `git push --force`, `mkfs`, `dd`, disk/`sudo` ops, writes outside `rootDir`) — off
  the happy path, defaulting to "block + surface," not "approve each." This is the one place I
  recommend not being fully unrestricted; final call is yours (see approval question).
- **Undo without git.** Since git is out, optional pre-write file snapshots into
  `.neurostack/snapshots/` give a filesystem-level rollback for a bad iteration — the safety net
  git would otherwise provide, kept purely in the state store.
- **Worker model is per-role.** Handoff advances each exhausted role's fallback chain and persists
  the choice in the checkpoint — not a single monolithic model swap.

---

## 4. Phased plan

Each phase is independently shippable with a concrete acceptance test. Critical path to the
headline demo ("never stops across models, in a real folder") is **A → B → D → F**.

### Phase A — Folder scoping + direct-apply write mode  ·  ✅ DONE (2026-07-19)
Implemented: `WorkspaceSession` + `workspaceContext` (ALS), `openWorkspace()` with folder
validation (exists/dir/writable/not-sensitive-root), `writeFileTransactional` (temp+rename),
`fileTools` direct-apply mode scoped to the selected folder. Verified live: the agent wrote a
file straight into a chosen temp folder (not staged). Tests: `workspaceService.test.ts`.
1. `WorkspaceSession` `{ rootDir, mode: 'direct' | 'staged', projectMap }` + `WorkspaceContext`
   (AsyncLocalStorage), replacing global `config.workspace.path` reads.
2. Folder validation on open: exists, directory, writable, not a sensitive root (`/`, home);
   refuse with a clear message.
3. Direct-apply in `fileTools`: transactional writes (temp file + atomic rename) so an
   exhausted/interrupted model never leaves a half-written file. `resolveInsideRoot(rootDir, …)`
   stays the containment guard.
4. Web folder-select UI (server-side directory browser scoped to an allowed base — browsers can't
   pick arbitrary FS paths) and CLI positional `<folder>`.

**Acceptance:** open folder X, run the loop, real files appear in X and nowhere else; path escape
attempts are rejected.

### Phase B — Autonomous terminal execution (`run_command`)  ·  ✅ DONE (2026-07-19)
Implemented: `run_command` tool (cwd-locked to rootDir, `spawn` in its own process group,
timeout + process-tree kill, output truncation), `commandPolicy` risk classifier, and the two
permission modes — **AUTO** (normal commands run freely; high-risk pauses for approval) and
**MANUAL** (every command pauses). Approval is delegated to a pluggable `ApprovalBroker`
(readline in the CLI). `folderAgentService` + `scripts/agentFolder.ts` (`npm run folder`) drive
the loop. Verified live: agent autonomously ran `node greet.js` in AUTO mode; tests cover
cwd-lock, both modes, high-risk gating, and no-broker refusal (`shellTool.test.ts`,
`commandPolicy.test.ts`). **Note on scoping:** cwd-lock + high-risk approval is best-effort
isolation; true FS confinement (a command using absolute paths) would need a container/sandbox —
tracked for a later phase.

Remaining original Phase B item (deferred): web-side folder picker UI (lands with Phase G UX).
1. `run_command` tool: runs a shell command with `cwd = rootDir`, streams stdout/stderr back to
   the loop as an observation, with timeout + output truncation. **No per-command approval.**
2. Bind it into the coder ReAct loop alongside the file tools, so the agent can install deps,
   build, run tests, read failures, fix, and re-run on its own (Claude-Code-style).
3. Narrow catastrophic-op denylist (configurable; default on) — blocks + surfaces rather than
   prompting per command. Everything else runs freely.
4. Concurrency/PTY handling, environment inheritance, and long-running-process guards
   (kill on timeout; no orphaned processes).

**Acceptance:** given "set up a Vite app and make the tests pass" in an empty folder, the agent
autonomously runs the needed commands and iterates to green with zero manual command approvals.

### Phase C — Project indexing  ·  ✅ DONE (2026-07-19)
Implemented: `projectIndexer` (stack detection via manifest sniffing, test-runner detection,
bounded file tree excluding deps/build/vcs, capped to a prompt budget); cached in
`.neurostack/project-map.json`; injected into the folder-agent system prompt on every run and
resume so each model/handoff starts situationally aware. Tests: `projectIndexer.test.ts` (5).
1. On open, scan `rootDir`: stack detection (manifest sniffing), file tree, test-runner
   detection; produce a compact project map capped to a prompt budget.
2. Cache in `.neurostack/project-map.json`; inject into planner/coder prompts; refresh on demand.

**Acceptance:** indexing a real repo detects the stack and yields a prompt-sized map; re-open uses
the cache.

### Phase D — Filesystem state store `.neurostack/`  ·  ✅ DONE (2026-07-19), NO git
Implemented: `StateStore` (pure-FS `.neurostack/`: `spec.md`, `plan.json`, `progress-log.jsonl`,
`context-summary.md`, `decisions.md`, `open-issues.md`, `state.json`, `snapshots/`, `.lock`);
`onEvent` progress hook on `runAgentLoop`; snapshot-on-write in `fileTools` (non-git undo);
SUMMARIZER-generated portable `context-summary.md`; `resumeFolderAgent` (rebuilds an onboarding
packet and re-enters the loop, re-scanning the folder for drift); stale-lock reclaim; CLI
`resume`/`status`. Tests: `stateStore.test.ts` (8). **Live-proven:** started a multi-file run,
hard-killed the whole process tree mid-loop (state left `running`, 2 files on disk), then
`resume` re-scanned and created exactly the *remaining* files without redoing finished work.

**Architectural decision (differs from the original sketch):** the continuity mechanism is the
**semantic filesystem state store**, not a LangGraph `BaseCheckpointSaver`. The reference design's
own principle is "structured state over raw transcripts"; a semantic plan+summary is model-portable
(the whole point of cross-model handoff), whereas a LangGraph binary checkpoint is graph-internal
and not portable. This also fits the folder-agent path, which runs the ReAct loop, not the graph.

**Finding that motivates Phase F:** a live resume hit Gemini's free-tier quota (5 req/min). The
planner/reviewer/etc. roles fall back across providers via `invokeForRole`, but the **coder
tool-loop binds a single model** (`bindTools` is model-specific) and cannot fall back mid-loop —
so it threw, the run was marked `failed`, and the quota error was recorded to `open-issues.md`
(still resumable). Closing that gap is exactly Phase F.
1. Layout: `spec.md`, `plan.json`, `progress-log.jsonl` (append-only), `context-summary.md`,
   `decisions.md`, `open-issues.md`, `checkpoints/`, `snapshots/`.
2. `FileCheckpointSaver implements BaseCheckpointSaver` (LangGraph), persisting thread state
   under `.neurostack/checkpoints/` — makes `resume` work after full process exit.
3. Project each loop iteration's append-only `history` into `progress-log.jsonl`; refresh
   `context-summary.md` via the SUMMARIZER role (compact, portable across models).
4. Optional pre-write snapshots into `.neurostack/snapshots/` for filesystem-level undo (the
   non-git safety net).
5. Idempotency guard: compare intended change vs. actual file state before applying, so a
   resumed/replayed step never double-writes.

**Acceptance:** kill the process mid-loop; `neurostack resume <folder>` rebuilds task status +
summary from disk and continues without redoing finished work. No `.git` writes anywhere.

### Phase E — Task decomposition  ·  ✅ DONE (2026-07-19)
Implemented (pragmatic form suited to the ReAct folder agent, not a heavyweight graph
controller): the PLANNER decomposes each requirement into 2–8 concrete, checkable subtasks
persisted as `plan.json` criteria; the subtask checklist is injected into the agent prompt; on
completion the VALIDATOR marks which subtasks are satisfied. This gives progress granularity and
a precise remaining-work list in the resume onboarding packet. Live-proven: a web run decomposed
"create greet.js…" into 5 tracked subtasks. (A full dependency-graph controller with per-node
scheduling remains possible later but would duplicate the ReAct loop's own self-direction.)
1. `TaskSpec` → `TaskGraph`: nodes `{ id, description, deps[], status, acceptanceCheck }`.
2. Planner emits the graph; controller picks the next actionable node; supports `blocked`/`failed`
   and a **global retry budget across models** (prevents infinite cross-model retry).
3. Persist as `plan.json`; statuses update in place.

**Acceptance:** a multi-feature spec runs in dependency order; a hard blocker is marked `blocked`
after the global budget and surfaced, not looped.

### Phase F — Continuity / cross-model handoff  ·  ✅ DONE (2026-07-19)  ← headline requirement
Implemented: provider-error classification (`RETRYABLE` → backoff, `EXHAUSTED` → fail over,
`FATAL` → surface) in `llmService`; **coder tool-loop cross-model handoff** in `runAgentLoop` —
on exhaustion it advances the coder provider chain, re-binds tools, compresses the transcript
(so a smaller-budget provider fits), and continues without losing work; transcript assistant
messages normalized to string content so a switched provider accepts the history;
`onHandoff` callback + `handoffCount`; folder agent persists each handoff (progress log +
`decisions.md` + `state.currentModel`) and, when *all* providers are exhausted, ends in
**`paused`** (resumable) rather than `failed`. Tests: handoff/all-exhausted/fatal cases in
`agentLoop.test.ts`, classification in `llmService.test.ts`.

**Live-proven (real models):** a multi-round run hit Gemini's free-tier quota mid-loop → handed
off `gemini → groq` → **Groq continued the work** (wrote 3 more files across 2 rounds) → when Groq
also hit its limit, the run **paused gracefully and resumably**. The loop did not stop on any
single model's limit — the headline requirement. (Full completion is only gated by free-tier
limits on both providers; `resume` continues once limits reset.)

**Third coder provider added (2026-07-19):** verified live that both NVIDIA Nemotron models
honor tool calls through our stack, then added the **30B nano** as the last-resort tail of the
CODER (and CHAT) chain → `gemini → groq → nvidia`. Now a Gemini+Groq exhaustion hands off to
NVIDIA nano and keeps coding instead of pausing (the 550B Ultra is kept off the tool loop — too
slow per round). Confirmed live: with Gemini quota-exhausted, the coder chain fell through and
still resolved. This materially reduces free-tier pausing.

Phase F refinement — **proactive handoff ✅ DONE (2026-07-19):** the coder loop now compresses the
transcript to the *current* provider's per-provider char budget (`PROVIDER_CHAR_BUDGET`) BEFORE
each call, so it pre-empts a context/rate error instead of wasting a call to discover it —
especially valuable right after handing off to a smaller-budget provider (e.g. Groq).
1. Limit signals: extend the transient-error classifier to separate *retryable* (backoff) from
   *exhaustion* (quota / context overflow → failover); read remaining-budget hints from provider
   headers/bodies where present.
2. Proactive threshold: estimate next-call tokens; hand off before a hard error at a configurable
   context fraction, with hard-failure as the backstop.
3. Graceful drain: finish the current atomic node (never mid-write — Phase A guarantees this),
   then force a `context-summary.md` + `decisions.md` update as the outgoing model's last act.
4. Handoff = advance the role's fallback chain, persist the choice to the checkpoint, resume from
   the filesystem state with a compact onboarding packet (`spec.md` + `plan.json` +
   `context-summary.md` + `open-issues.md`) — structured data, not transcript.
5. Resume drift check: incoming model re-scans folder vs. `plan.json` before continuing.
6. All-exhausted → graceful pause written to `.neurostack/`; `resume` picks up hours/days later.

**Acceptance:** inject a 429/quota error mid-task; system drains, writes the handoff note,
advances the model, and completes — the eval harness shows a run that changes worker models
mid-flight and still reaches `complete`. (We've already seen an unplanned version: Groq validator
413 → Gemini fallback finished the verdict.)

### Phase G — CLI + UX + safety  ·  ✅ DONE (2026-07-19)
CLI already shipped in A/B/D (`start` / `resume` / `status`). Added the **web layer**:
`folderRoutes` — `GET /api/folder/browse` (server-side directory browser scoped to a configurable
`FOLDER_AGENT_ROOT`, traversal-guarded), `GET /api/folder/status`, `POST /api/folder/run` (SSE
streaming live progress), and `POST /api/folder/approve` with an in-memory pending-approval
registry so the two permission modes work interactively over the web (auto asks only on high-risk
commands; manual asks on every command; 5-min auto-deny backstop). Minimal UI at `/folder`
(`folder.hbs` + `public/js/folder.js`): browse → pick → prompt → mode → live progress log with
inline Allow/Deny. Linked from the chat sidebar. Safety denylist from Phase B is enforced;
no git touched. **Live-proven end-to-end** through the web: browse + traversal guard + a real run
streaming handoff/round/paused/result events and writing files into the chosen folder.
1. CLI: `neurostack <folder>` (start), `neurostack resume <folder>`, `neurostack status <folder>`.
2. Live status: current task, active model per role, progress %, recent commands, handoff events.
3. Safety: the catastrophic-op denylist from Phase B, surfaced clearly; no git commands anywhere
   in automation. (Manual `@commit`-style command is explicitly out of scope / future.)

**Acceptance:** full loop drivable from CLI on a real folder; catastrophic ops blocked;
status/resume work across restarts; git never touched.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Direct-apply corrupts real code on a bad iteration (no git to roll back) | Optional pre-write snapshots in `.neurostack/snapshots/`; transactional writes; user can enable "snapshot every iteration" |
| Autonomous shell runs something destructive | Narrow catastrophic denylist (configurable), cwd locked to `rootDir`, timeouts + process kill; everything logged to `progress-log.jsonl` |
| Long-running / hanging commands stall the loop | Per-command timeout, output cap, forced process termination |
| State store drifts from actual folder | Checkpointer is source of truth; `.md` files are projections; incoming model re-scans on resume |
| Cross-model prompt portability | Onboarding packet is structured + compact summary (already how roles are prompted) |
| Free-tier limits slow long runs | Continuity is the mitigation; document tier upgrades |
| Concurrent runs on one folder | Lockfile in `.neurostack/` (single active session per folder) |

## 6. Open questions (my defaults)
- **Shell safety posture** — default: autonomous + narrow catastrophic denylist. (Approval Q below.)
- **Snapshots on by default?** — default: on for the first run of a folder, then user-configurable.
- **Tests before "done"?** — run the detected test command if one exists; warn-don't-block if none.
- **Local-only state?** — yes; `.neurostack/` is local. No cloud sync in scope.

## 7. Effort
Phases A–G ≈ **4–5 weeks** solo. Reuses the entire existing loop/router/verify stack. Dropping git
from the plan removes ~2–3 days of integration; adding autonomous shell adds ~4–5 — roughly net
neutral vs. the prior version.
