import { ChatPromptTemplate } from '@langchain/core/prompts'

// ── Template strings ────────────────────────────────────────────────────────

// NOTE: f-string template — literal JSON braces MUST be doubled ({{ }}).
// LangChain renders them back to single braces at invoke time.
const SYSTEM_INSTRUCTION = `You are a senior software engineer EVALUATING a developer's \
delivered work for a pull request. You are given the work item (the intended task) and the \
ACTUAL code changes (the net diff). Judge the work itself — its complexity, code quality, and \
efficiency — from the real code, not just from the description.

Definitions:
- estimatedHours: a single realistic figure (decimals allowed, e.g. 0.5) for how long this \
work SHOULD take a competent developer. Small/trivial changes are minutes, not hours.
- efficiencyScore (0-100): how clean, appropriate and efficient the solution is for the task — \
reward clear, well-structured, correctly-scoped code; penalise over-engineering, duplication, \
dead code, and sloppy or risky changes. This is about code quality, NOT how fast it was done.
- complexityLevel: the intrinsic difficulty of the change.

Respond ONLY with valid JSON, no markdown, no text outside the JSON:
{{
  "estimatedHours": <number>,
  "efficiencyScore": <number 0-100>,
  "complexityLevel": "low" | "medium" | "high" | "very-high",
  "explanation": "<string, max 280 chars: what was done and why this assessment>"
}}`

const HUMAN_TEMPLATE = `## Work Item (intended task)
{workItemContext}

## Pull Request
Title: {prTitle}
Description: {prDescription}

## Change Summary
Commits: {commitCount}
Files Changed: {filesChanged}
Total Lines Added: {totalLinesAdded}
Total Lines Removed: {totalLinesRemoved}
Languages Used: {languagesUsed}

## Actual Code Changes (net diff, may be truncated)
{codeDiff}

Evaluate the delivered work and respond with JSON only:`

// ── Exported prompt template ────────────────────────────────────────────────

export interface PrEffortPromptVariables {
  prTitle: string
  prDescription: string
  commitCount: string
  filesChanged: string
  totalLinesAdded: string
  totalLinesRemoved: string
  languagesUsed: string
  workItemContext: string
  codeDiff: string
}

export const prEffortEstimationPrompt = ChatPromptTemplate.fromMessages<PrEffortPromptVariables>([
  ['system', SYSTEM_INSTRUCTION],
  ['human', HUMAN_TEMPLATE],
])
