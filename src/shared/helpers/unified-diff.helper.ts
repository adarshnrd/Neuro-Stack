/**
 * Lightweight, bounded unified-diff generation for feeding real code changes to
 * the AI. Not a full git diff implementation — it produces a compact, readable
 * patch (changed lines with a little context) that's good enough for an LLM to
 * assess quality/complexity, while staying within strict size limits.
 */

export interface FileDiffInput {
  /** Final path of the file. */
  path: string
  changeType: 'add' | 'modify' | 'delete' | 'rename'
  language: string
  /** Old content (null for pure additions). */
  oldContent: string | null
  /** New content (null for deletions). */
  newContent: string | null
}

export interface BuiltPatch {
  /** The assembled patch text to send to the model. */
  patch: string
  /** True when some files/hunks were omitted to respect the size budget. */
  truncated: boolean
  filesIncluded: number
  filesTotal: number
}

// Files whose contents are noise for effort/quality analysis — counted in stats
// but never sent to the model (lockfiles, generated, binaries, vendored, etc.).
const NOISE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)Cargo\.lock$/,
  /\.min\.(js|css)$/i,
  /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|mov|mp3|wasm)$/i,
  /(^|\/)(dist|build|out|coverage|node_modules|vendor|__snapshots__)\//,
  /\.snap$/,
]

export function isNoiseFile(path: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(path))
}

// Guard rails so a pathological file can't blow up memory or the prompt.
const MAX_FILE_LINES_FOR_LCS = 2000
const CONTEXT_LINES = 2

function splitLines(text: string): string[] {
  const t = text.endsWith('\n') ? text.slice(0, -1) : text
  return t.length === 0 ? [] : t.split('\n')
}

/** Histogram (multiset) fallback counts when a file is too large for LCS. */
function histogramCounts(a: string[], b: string[]): { added: number; removed: number } {
  const tally = new Map<string, number>()
  for (const l of a) tally.set(l, (tally.get(l) ?? 0) - 1)
  for (const l of b) tally.set(l, (tally.get(l) ?? 0) + 1)
  let added = 0
  let removed = 0
  for (const c of tally.values()) {
    if (c > 0) added += c
    else if (c < 0) removed += -c
  }
  return { added, removed }
}

type Op = { type: 'eq' | 'del' | 'add'; line: string }

/** LCS-based line diff → ordered op list. Bounded by MAX_FILE_LINES_FOR_LCS. */
function lcsOps(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  if (n > MAX_FILE_LINES_FOR_LCS || m > MAX_FILE_LINES_FOR_LCS) return null

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: a[i] })
      i++
    } else {
      ops.push({ type: 'add', line: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++] })
  while (j < m) ops.push({ type: 'add', line: b[j++] })
  return ops
}

/** Render ops as a compact diff: changed lines with a little surrounding context. */
function renderHunks(ops: Op[]): { body: string; added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added++
    else if (op.type === 'del') removed++
  }

  // Mark which equal lines to keep as context (within CONTEXT_LINES of a change).
  const keep = new Array<boolean>(ops.length).fill(false)
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'eq') {
      for (let d = -CONTEXT_LINES; d <= CONTEXT_LINES; d++) {
        const idx = k + d
        if (idx >= 0 && idx < ops.length) keep[idx] = true
      }
    }
  }

  const lines: string[] = []
  let elided = false
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === 'eq' && !keep[k]) {
      if (!elided) {
        lines.push('  …')
        elided = true
      }
      continue
    }
    elided = false
    const prefix = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '
    lines.push(`${prefix} ${op.line}`)
  }
  return { body: lines.join('\n'), added, removed }
}

function fileHeader(f: FileDiffInput, added: number, removed: number): string {
  return `### ${f.path} (${f.changeType}, +${added}/-${removed}) [${f.language}]`
}

/**
 * Assemble a size-capped patch from a set of changed files. Files are included
 * until `maxChars` is reached; the rest are summarised as a trailing note.
 */
export function buildPatch(files: FileDiffInput[], maxChars: number): BuiltPatch {
  const blocks: string[] = []
  let used = 0
  let included = 0
  let truncated = false

  for (const f of files) {
    if (isNoiseFile(f.path)) {
      truncated = true
      continue
    }

    let block: string
    if (f.changeType === 'delete') {
      const removed = splitLines(f.oldContent ?? '').length
      block = `${fileHeader(f, 0, removed)}\n(file deleted)`
    } else if (f.changeType === 'add') {
      const newLines = splitLines(f.newContent ?? '')
      const body = newLines.map((l) => `+ ${l}`).join('\n')
      block = `${fileHeader(f, newLines.length, 0)}\n${body}`
    } else {
      const a = splitLines(f.oldContent ?? '')
      const b = splitLines(f.newContent ?? '')
      const ops = lcsOps(a, b)
      if (!ops) {
        const { added, removed } = histogramCounts(a, b)
        block = `${fileHeader(f, added, removed)}\n(large file — body omitted)`
      } else {
        const { body, added, removed } = renderHunks(ops)
        block = `${fileHeader(f, added, removed)}\n${body}`
      }
    }

    if (used + block.length > maxChars) {
      truncated = true
      break
    }
    blocks.push(block)
    used += block.length + 1
    included++
  }

  return {
    patch: blocks.join('\n\n'),
    truncated,
    filesIncluded: included,
    filesTotal: files.length,
  }
}
