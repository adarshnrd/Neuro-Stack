# Agent Loop — Implementation Plan

> Goal: an autonomous agent that reads the relevant docs, plans, implements, reviews its own
> work against acceptance criteria, fixes the gaps, and repeats until a task's criteria are
> fully met — orchestrated with LangGraph, using three model providers routed by role.
>
> Status: **All phases (0–4) implemented and verified** (2026-07-18)
>
> Phase 0 ✅ — Groq + NVIDIA providers, `ModelRole` routing with fallback chains,
> `invokeForRole()` in llmService. All 6 roles smoke-tested live against all 3 providers.
> Phase 1 ✅ — ReAct tool loop (`src/llm/agentLoop.ts`) wired into `@AGENT` with the four
> file tools bound, round cap + wrap-up, tool-error feedback, SUMMARIZER transcript
> compression. Verified: `@AGENT` staged (not directly wrote) a changeset via `write_file`.
> Phase 2 ✅ — LangGraph loop (`src/graph/`): plan → approval (interrupt) → implement →
> verify → review → judge → rework|finalize. Task specs (`tasks/<slug>.md`), iteration cap,
> stall detection, MemorySaver checkpointer, changeset-aware reads. Replaced the dead scaffold.
> Phase 3 ✅ — Sandboxed `run_check` verification (allowlisted tsc/test/lint + always-on JS
> syntax check, applied in a temp workspace copy so the real workspace is never written before
> approval); `run_check` bound into the coder loop; SSE `/api/loop` endpoint + `@AGENT_LOOP`
> chat trigger with a live progress panel.
> Phase 4 ✅ — 3 eval task specs + harness (`npm run eval`) reporting completion rate,
> iterations, and wall time.
>
> **Live end-to-end proof:** `npm run eval fizzbuzz` completed 4/4 criteria in 1 iteration —
> plan(NVIDIA) → implement(Gemini tool loop, self-verified) → review(NVIDIA) → verdict. The
> Groq validator hit a free-tier token cap mid-run and the fallback chain automatically
> recovered via Gemini. 54/54 tests, typecheck + lint clean, server boots with routes gated.
>
> **Known free-tier limits:** Groq TPM (12k) can 413 on large validator prompts — mitigated by
> review-note truncation + fallback; NVIDIA reasoning is slow (~2 min/review). Upgrade tiers
> before heavy autonomous runs.

---

## 1. Model roles (verified working 2026-07-18)

| Role | Provider / model | Used for | Why this model |
|------|------------------|----------|----------------|
| `SUMMARIZER` | **Groq** · `llama-3.3-70b-versatile` | Doc digestion, inter-iteration context compression | Fastest + cheapest; runs every iteration |
| `VALIDATOR` | **Groq** · `llama-3.3-70b-versatile` (JSON mode, temp 0) | Structured verdict against acceptance criteria | Strict JSON output, near-free |
| `PLANNER` | **NVIDIA Ultra** · `nemotron-3-ultra-550b-a55b` (thinking on) → nano → Gemini → Groq | Task analysis → implementation plan | Highest-parameter reasoning; runs once per task so latency (~20s) is fine and plan quality compounds |
| `REVIEWER` | **NVIDIA Ultra** · same model, fresh context → nano → Gemini → Groq | Diff-vs-requirements gap analysis | Best reasoning for gap-finding; different family than the coder → counters self-review bias |
| `CODER` | **Gemini** · `gemini-2.5-flash` → Groq → **NVIDIA nano** | Tool-calling implementation loop | Gemini leads (proven tool calling); Groq next; NVIDIA 30B nano is a verified tool-capable last resort so a Gemini+Groq exhaustion keeps going instead of pausing (Ultra 550B kept out — too slow per round) |
| `CHAT` | **Gemini** → Groq → **NVIDIA nano** | Normal chat path | Same fallback tail for availability |

Fallback chains: reasoning roles cascade Ultra → nano → Gemini → Groq; other roles fall back
Gemini ↔ Groq. NVIDIA reasoning models are never a fallback target for non-reasoning roles
(too slow for stand-in duty).

---

## 2. Phases

### Phase 0 — Multi-provider foundation (~2 days) ← start here
Everything else builds on this; it also immediately improves the existing chat/@AGENT flow
(provider fallback on Gemini "high demand" errors, which are in the logs today).

1. `npm i @langchain/groq @langchain/openai` (NVIDIA NIM is OpenAI-compatible → `ChatOpenAI`
   with `baseURL: https://integrate.api.nvidia.com/v1`)
2. Env/config: `GROQ_API_KEY`, `GROQ_MODEL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL` (already in
   `.env` / `.env.example`) → Zod schema → `config.llm.providers`
3. Extend `LLMProvider` enum (`GROQ`, `NVIDIA`) + provider factories alongside
   `geminiProvider.ts`
4. New `ModelRole` enum + role→(provider, model, options) map with env overrides
5. `llmService.invokeForRole(role, messages, opts)` — routes by role, reuses the existing
   retry/backoff, adds ordered fallback chain per role
6. Unit tests (role routing, fallback order) + a live smoke script `scripts/smokeProviders.ts`

**Acceptance:** all three providers callable through one interface; chat still works; Gemini
outage automatically falls back to Groq for the CHAT role.

### Phase 1 — Real tool-calling agent (~4 days)
Today `@AGENT` makes a single LLM call and can't use its own tools.

1. Bind `fileTools` + `listDirectory` to the CODER model (`bindTools`)
2. ReAct execute-observe loop: model call → run tool calls → append results → repeat until
   no tool calls or iteration cap (default 15 tool rounds)
3. Tool errors fed back as observations (not thrown); per-call timeout; token budget guard
4. All writes stay inside the existing changeset staging flow (no direct writes)
5. SUMMARIZER compresses the transcript when context exceeds a threshold

**Acceptance:** `@AGENT add an endpoint X` actually reads the workspace, writes staged files,
and the Review panel shows a coherent multi-file changeset.

### Phase 2 — The loop itself, on LangGraph (~5 days)
1. Task spec format: `tasks/<slug>.md` with front-matter + `- [ ]` acceptance criteria
2. Graph nodes: `loadContext` → `plan` (PLANNER) → `approvalGate` (LangGraph interrupt —
   human approves plan, reusing governance rules) → `implement` (Phase 1 loop) →
   `review` (REVIEWER, fresh context: requirements + diff only) → `verdict` (VALIDATOR →
   `{ complete: boolean, unmetCriteria: [...], findings: [...] }`) → loop back to
   `implement` with findings, or `finalize`
3. Loop control: max 6 iterations; stall detection (identical diff two rounds → stop with
   report); graceful exit reports met/unmet criteria and checks off the task `.md`
4. Checkpointing: LangGraph MemorySaver first; Supabase checkpointer later
5. Replaces the dead `src/graph/` scaffold (resolves the "wire it or remove it" decision)

**Acceptance:** a seeded demo task runs plan→approve→implement→review→rework and stops with
all criteria checked, within iteration budget.

### Phase 3 — Objective verification + progress UX (~4 days)
1. Sandboxed `run_check` tool: allowlisted commands only (`tsc --noEmit`, `npm test`,
   `eslint`), cwd locked to workspace, timeout + output truncation — results feed the
   REVIEWER so the loop has ground truth
2. SSE endpoint streaming loop progress (node transitions, iteration count, verdicts) +
   minimal UI panel in the chat view

**Acceptance:** a task whose tests fail on iteration 1 self-corrects by iteration ≤3; user
sees live loop progress.

### Phase 4 — Evals & hardening (ongoing, ~1 week initial)
1. 5–10 benchmark tasks in `evals/` with expected outcomes
2. Harness: run task × role-assignment matrix → completion rate, iterations, tokens, wall time
3. Use results to tune prompts and validate/adjust the role table above (data over vibes)

---

## 3. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Free-tier rate limits (Groq TPM/TPD, NVIDIA credits) | Retry + cross-provider fallback; budget guard aborts loop cleanly; upgrade tiers before long sessions |
| Nemotron reasoning latency (large `max_tokens`, thinking) | Only in once-per-iteration roles (plan/review), never in the tool loop; cap `reasoning_budget` |
| Tool-call reliability if CODER is ever moved off Gemini | Phase 4 benchmark gates any role change |
| Self-review blindness | Fresh-context cross-family REVIEWER + Phase 3 objective signals |
| Non-convergence (thrash/oscillation) | Iteration cap, stall detector, graceful-exit report |
| Context growth per iteration | SUMMARIZER compression between iterations |

## 4. Out of scope (this plan)
Remaining @commands (CREATE_PR etc.), multi-repo workspaces, vector memory, CSP/vendoring.

## 5. Estimate
Phases 0–3 ≈ **3 working weeks** solo; Phase 4 ongoing. Each phase is independently
shippable and mergeable.
