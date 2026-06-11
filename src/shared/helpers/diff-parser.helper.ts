export type ChangeType = 'add' | 'modify' | 'delete' | 'rename'

export interface ChangedFile {
  filePath: string
  linesAdded: number
  linesRemoved: number
  changeType: ChangeType
  language: string
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  rs: 'rust',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  tf: 'terraform',
  tfvars: 'terraform',
  xml: 'xml',
  toml: 'toml',
  dart: 'dart',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  r: 'r',
  scala: 'scala',
  ex: 'elixir',
  exs: 'elixir',
  vue: 'vue',
  svelte: 'svelte',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
}

export function detectLanguage(filePath: string): string {
  const base = (filePath.split('/').pop() ?? filePath).toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  const ext = base.split('.').pop() ?? ''
  return EXT_TO_LANGUAGE[ext] ?? 'unknown'
}

function stripDiffPrefix(path: string): string {
  // Strip leading "a/" or "b/" added by git diff
  return path.replace(/^[ab]\//, '')
}

interface FileState {
  filePath: string
  changeType: ChangeType
  linesAdded: number
  linesRemoved: number
}

export function parseDiff(rawDiff: string): ChangedFile[] {
  const results: ChangedFile[] = []
  const lines = rawDiff.split('\n')

  let current: FileState | null = null

  const flush = (): void => {
    if (!current) return
    results.push({
      filePath: current.filePath,
      linesAdded: current.linesAdded,
      linesRemoved: current.linesRemoved,
      changeType: current.changeType,
      language: detectLanguage(current.filePath),
    })
    current = null
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      current = { filePath: '', changeType: 'modify', linesAdded: 0, linesRemoved: 0 }
      continue
    }

    if (!current) continue

    if (line.startsWith('new file mode')) {
      current.changeType = 'add'
      continue
    }

    if (line.startsWith('deleted file mode')) {
      current.changeType = 'delete'
      continue
    }

    if (line.startsWith('rename from ')) {
      current.changeType = 'rename'
      continue
    }

    if (line.startsWith('rename to ')) {
      current.changeType = 'rename'
      current.filePath = line.slice('rename to '.length).trim()
      continue
    }

    // +++ line carries the new file path for add/modify; for deletes use --- line
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      if (path !== '/dev/null') {
        current.filePath = stripDiffPrefix(path)
      }
      continue
    }

    if (line.startsWith('--- ') && current.changeType === 'delete') {
      const path = line.slice(4).trim()
      if (path !== '/dev/null') {
        current.filePath = stripDiffPrefix(path)
      }
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.linesAdded++
      continue
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      current.linesRemoved++
    }
  }

  flush()
  return results
}
