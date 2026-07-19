import { ChatPromptTemplate } from '@langchain/core/prompts'

// ── Template strings ────────────────────────────────────────────────────────

// NOTE: This is an f-string prompt template, so literal JSON braces MUST be
// doubled ({{ }}) — LangChain renders them back to single braces when the
// prompt is invoked. Single braces here are parsed as template variables and
// make every call throw "Missing value for input variable". The prompt text
// the model receives is unchanged.
const SYSTEM_INSTRUCTION = `You are a senior software engineer EVALUATING a developer's commit. \
You are given the linked work item (intent) and the ACTUAL code changes. Judge the work from the \
real code. "efficiencyScore" (0-100) rates how clean, appropriate and efficient the solution is \
(reward clear, well-scoped code; penalise over-engineering, duplication, dead code, risky changes) \
— it is about code quality, NOT speed. "estimatedEffortHours" is a single realistic figure for how \
long this should take a competent developer. Respond ONLY with valid JSON, no markdown, no text \
outside the JSON:
{{
  "estimatedEffortHours": <number>,
  "efficiencyScore": <number 0-100>,
  "complexityLevel": "low" | "medium" | "high" | "very-high",
  "hasTests": <boolean>,
  "hasDocumentation": <boolean>,
  "hasBugFix": <boolean>,
  "hasRefactoring": <boolean>,
  "isSecurityRelated": <boolean>,
  "technicalSummary": "<string, max 300 chars>"
}}`

const HUMAN_TEMPLATE = `## Commit Information
Commit Message: {commitMessage}

## Code Changes
Files Changed: {filesChanged}
Total Lines Added: {totalLinesAdded}
Total Lines Removed: {totalLinesRemoved}
Languages Used: {languagesUsed}

## File Change Summary
{diffSummary}

## Actual Code Changes (may be truncated)
{codeDiff}

## Linked Work Item
Title: {workItemTitle}
Description: {workItemDescription}
Estimated Hours: {workItemEstimatedHours}

Evaluate the above commit and provide your JSON response:`

// ── Exported prompt template ────────────────────────────────────────────────

/**
 * Input variables that must be provided when invoking this prompt.
 */
export interface EffortPromptVariables {
  commitMessage: string
  filesChanged: string
  totalLinesAdded: string
  totalLinesRemoved: string
  languagesUsed: string
  diffSummary: string
  codeDiff: string
  workItemTitle: string
  workItemDescription: string
  workItemEstimatedHours: string
}

export const effortEstimationPrompt = ChatPromptTemplate.fromMessages<EffortPromptVariables>([
  ['system', SYSTEM_INSTRUCTION],
  ['human', HUMAN_TEMPLATE],
])
