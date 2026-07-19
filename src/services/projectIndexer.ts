import fs from 'fs/promises';
import path from 'path';
import { ProjectMap } from '../types/workspaceTypes.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('projectIndexer');

const IGNORED_DIRS = new Set(['node_modules', '.git', '.neurostack', 'dist', 'build', '.next', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', 'target']);
const MAX_ENTRIES = 250;
const MAX_DEPTH = 4;
const TREE_CHAR_BUDGET = 4_000;

/** Manifest file → stack label. Presence of the file implies the stack. */
const STACK_MANIFESTS: { file: string; stack: string }[] = [
  { file: 'package.json', stack: 'Node.js' },
  { file: 'tsconfig.json', stack: 'TypeScript' },
  { file: 'deno.json', stack: 'Deno' },
  { file: 'pyproject.toml', stack: 'Python' },
  { file: 'requirements.txt', stack: 'Python' },
  { file: 'Pipfile', stack: 'Python' },
  { file: 'go.mod', stack: 'Go' },
  { file: 'Cargo.toml', stack: 'Rust' },
  { file: 'pom.xml', stack: 'Java (Maven)' },
  { file: 'build.gradle', stack: 'Java/Kotlin (Gradle)' },
  { file: 'Gemfile', stack: 'Ruby' },
  { file: 'composer.json', stack: 'PHP' },
  { file: 'Dockerfile', stack: 'Docker' },
];

/**
 * Scans a project folder and produces a compact, prompt-sized situational map:
 * detected stack(s), a detected test command, a file count, and a bounded file
 * tree. Gives every model/handoff the same starting awareness of the project.
 */
export async function buildProjectMap(rootDir: string): Promise<ProjectMap> {
  const root = path.resolve(rootDir);
  const rootEntries = await safeReaddir(root);
  const rootNames = new Set(rootEntries.map((e) => e.name));

  const detectedStack = STACK_MANIFESTS.filter((m) => rootNames.has(m.file)).map((m) => m.stack);
  const testCommand = await detectTestCommand(root, rootNames);

  const { tree, fileCount } = await buildTree(root);

  const map: ProjectMap = {
    rootDir: root,
    detectedStack: detectedStack.length ? [...new Set(detectedStack)] : ['unknown'],
    fileCount,
    tree: testCommand ? `${tree}\n\n(detected test command: ${testCommand})` : tree,
  };

  log.info('Project indexed', {
    source: 'projectIndexer#buildProjectMap',
    rootDir: root,
    stack: map.detectedStack,
    fileCount,
  });
  return map;
}

/** Renders a project map for injection into a system prompt. */
export function renderProjectMap(map: ProjectMap): string {
  return [
    '## Project Map',
    `Detected stack: ${map.detectedStack.join(', ')}`,
    `Files (excluding deps/build): ${map.fileCount}`,
    '',
    '```',
    map.tree,
    '```',
  ].join('\n');
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function detectTestCommand(root: string, rootNames: Set<string>): Promise<string | null> {
  if (rootNames.has('package.json')) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) return 'npm test';
    } catch { /* ignore malformed package.json */ }
  }
  if (rootNames.has('pyproject.toml') || rootNames.has('pytest.ini') || rootNames.has('tox.ini')) return 'pytest';
  if (rootNames.has('go.mod')) return 'go test ./...';
  if (rootNames.has('Cargo.toml')) return 'cargo test';
  return null;
}

async function buildTree(root: string): Promise<{ tree: string; fileCount: number }> {
  const lines: string[] = [];
  let fileCount = 0;
  let truncated = false;

  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || fileCount >= MAX_ENTRIES) {
      truncated = truncated || fileCount >= MAX_ENTRIES;
      return;
    }
    const entries = (await safeReaddir(dir))
      .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)) && !e.name.startsWith('.'))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (fileCount >= MAX_ENTRIES) { truncated = true; break; }
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(path.join(dir, entry.name), `${prefix}  `, depth + 1);
      } else {
        fileCount++;
        lines.push(rel);
      }
    }
  };

  await walk(root, '', 0);
  let tree = lines.join('\n');
  if (truncated) tree += `\n… (truncated at ${MAX_ENTRIES} files)`;
  if (tree.length > TREE_CHAR_BUDGET) tree = `${tree.slice(0, TREE_CHAR_BUDGET)}\n… (truncated)`;
  return { tree: tree || '(empty folder)', fileCount };
}

async function safeReaddir(dir: string): Promise<{ name: string; isDirectory: () => boolean }[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
