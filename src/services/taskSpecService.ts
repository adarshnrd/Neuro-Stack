import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { AcceptanceCriterion, TaskSpec } from '../types/agentTaskTypes.js';
import { ensureDirectory, fileExists } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('taskSpecService');

const TASKS_DIR = 'tasks';
const CHECKLIST_RE = /^\s*-\s*\[( |x|X)\]\s+(.*)$/;

function tasksDir(): string {
  return path.join(config.context.basePath, TASKS_DIR);
}

/** Derives a filesystem-safe slug from a title. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
}

/**
 * Parses task-spec markdown into a structured TaskSpec.
 *
 * Format:
 *   # Title
 *   <description paragraphs>
 *   ## Acceptance Criteria
 *   - [ ] criterion one
 *   - [x] criterion two (already met)
 */
export function parseTaskSpec(slug: string, markdown: string): TaskSpec {
  const lines = markdown.split(/\r?\n/);
  let title = slug;
  const descriptionLines: string[] = [];
  const criteria: AcceptanceCriterion[] = [];
  let inCriteria = false;

  for (const line of lines) {
    const heading = line.match(/^#\s+(.*)$/);
    if (heading) {
      title = heading[1].trim();
      continue;
    }

    if (/^##\s+/.test(line)) {
      inCriteria = /acceptance|criteria|requirements/i.test(line);
      continue;
    }

    const check = line.match(CHECKLIST_RE);
    if (check) {
      criteria.push({ done: check[1].toLowerCase() === 'x', text: check[2].trim() });
      continue;
    }

    if (!inCriteria && line.trim()) {
      descriptionLines.push(line.trim());
    }
  }

  return { slug, title, description: descriptionLines.join('\n'), criteria };
}

/** Serializes a TaskSpec back to markdown, preserving criteria checkbox state. */
export function serializeTaskSpec(spec: TaskSpec): string {
  const out: string[] = [`# ${spec.title}`, ''];
  if (spec.description.trim()) {
    out.push(spec.description.trim(), '');
  }
  out.push('## Acceptance Criteria', '');
  for (const c of spec.criteria) {
    out.push(`- [${c.done ? 'x' : ' '}] ${c.text}`);
  }
  out.push('');
  return out.join('\n');
}

/** Loads a task spec from disk by slug. Returns null if absent. */
export async function loadTaskSpec(slug: string): Promise<TaskSpec | null> {
  const filePath = path.join(tasksDir(), `${slug}.md`);
  if (!(await fileExists(filePath))) return null;
  const markdown = await fs.readFile(filePath, 'utf-8');
  const spec = parseTaskSpec(slug, markdown);
  spec.sourcePath = filePath;
  return spec;
}

/**
 * Builds a task spec from a free-text requirement, deriving criteria heuristically
 * when none are explicitly provided. Used when the loop is launched from chat
 * rather than an existing spec file.
 */
export function taskSpecFromRequirement(requirement: string): TaskSpec {
  const firstLine = requirement.split(/\r?\n/)[0].trim();
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  const explicit = parseTaskSpec(slugify(title), requirement).criteria;

  return {
    slug: slugify(title),
    title,
    description: requirement.trim(),
    criteria: explicit.length > 0 ? explicit : [{ text: requirement.trim(), done: false }],
  };
}

/** Persists a task spec to `tasks/<slug>.md`, creating the directory if needed. */
export async function saveTaskSpec(spec: TaskSpec): Promise<string> {
  await ensureDirectory(tasksDir());
  const filePath = path.join(tasksDir(), `${spec.slug}.md`);
  await fs.writeFile(filePath, serializeTaskSpec(spec), 'utf-8');
  log.info('Task spec saved', { source: 'taskSpecService#saveTaskSpec', slug: spec.slug, filePath });
  return filePath;
}

/**
 * Marks the given criteria (by exact text) as done and rewrites the spec file.
 * Criteria not present in `metTexts` keep their current state.
 */
export async function updateCriteriaStatus(spec: TaskSpec, metTexts: string[]): Promise<void> {
  const met = new Set(metTexts.map((t) => t.trim()));
  for (const c of spec.criteria) {
    if (met.has(c.text.trim())) c.done = true;
  }
  if (spec.sourcePath) {
    await fs.writeFile(spec.sourcePath, serializeTaskSpec(spec), 'utf-8');
    log.debug('Criteria status updated', { source: 'taskSpecService#updateCriteriaStatus', slug: spec.slug });
  }
}
