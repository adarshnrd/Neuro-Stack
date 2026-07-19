import { ComplexityLevel } from '@app/database/schemas/ai-analysis.schema'

// ── Output types ──────────────────────────────────────────────────────────

export interface AnalysisOutput {
  estimatedEffortHours: number
  /** AI code-quality / efficiency score (0–100); null when not provided. */
  efficiencyScore: number | null
  complexityLevel: ComplexityLevel
  hasTests: boolean
  hasDocumentation: boolean
  hasBugFix: boolean
  hasRefactoring: boolean
  isSecurityRelated: boolean
  technicalSummary: string
  /** True when the model output could not be parsed — downstream should log/skip */
  _parseError?: boolean
}

const DEFAULTS: AnalysisOutput = {
  estimatedEffortHours: 0,
  efficiencyScore: null,
  complexityLevel: ComplexityLevel.MEDIUM,
  hasTests: false,
  hasDocumentation: false,
  hasBugFix: false,
  hasRefactoring: false,
  isSecurityRelated: false,
  technicalSummary: 'Analysis unavailable — JSON parse error',
  _parseError: true,
}

const VALID_COMPLEXITY = new Set<string>(Object.values(ComplexityLevel))

function normalise(raw: unknown): AnalysisOutput {
  if (typeof raw !== 'object' || raw === null) return DEFAULTS
  const r = raw as Record<string, unknown>
  const complexityRaw = String(r.complexityLevel ?? '').toLowerCase()
  const scoreRaw = Number(r.efficiencyScore)

  return {
    estimatedEffortHours: Math.max(0, Number(r.estimatedEffortHours) || 0),
    efficiencyScore: Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
      : null,
    complexityLevel: VALID_COMPLEXITY.has(complexityRaw)
      ? (complexityRaw as ComplexityLevel)
      : ComplexityLevel.MEDIUM,
    hasTests: Boolean(r.hasTests),
    hasDocumentation: Boolean(r.hasDocumentation),
    hasBugFix: Boolean(r.hasBugFix),
    hasRefactoring: Boolean(r.hasRefactoring),
    isSecurityRelated: Boolean(r.isSecurityRelated),
    technicalSummary: String(r.technicalSummary ?? '').slice(0, 300) || 'No summary provided',
  }
}

/**
 * Parse the raw string returned by the LLM into typed AnalysisOutput.
 *
 * Strategy:
 *   1. JSON.parse() directly
 *   2. On SyntaxError: extract first {...} block with regex, try again
 *   3. On second failure: return DEFAULTS with _parseError:true
 */
export function parseAIResponse(raw: string): AnalysisOutput {
  // ── Attempt 1: direct parse ─────────────────────────────────────────────
  try {
    return normalise(JSON.parse(raw))
  } catch (err) {
    if (!(err instanceof SyntaxError)) return { ...DEFAULTS }
  }

  // ── Attempt 2: extract first JSON object block ──────────────────────────
  const match = /\{[\s\S]*\}/.exec(raw)
  if (match) {
    try {
      return normalise(JSON.parse(match[0]))
    } catch {
      // fall through to defaults
    }
  }

  // ── Attempt 3: give up, return safe defaults ────────────────────────────
  return { ...DEFAULTS }
}
