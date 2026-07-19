import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  OnboardingPacket,
  ProgressEvent,
  RunState,
  RunStatus,
  StoredPlan,
} from '../types/stateStoreTypes.js';
import { ProjectMap } from '../types/workspaceTypes.js';
import { fileExists, resolveInsideRoot } from '../utils/fileUtil.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('stateStore');

const DIR = '.neurostack';

/**
 * Filesystem-backed state store for a folder-agent run — the durable
 * continuity mechanism (no git). Everything lives under `<root>/.neurostack/`.
 * This class is pure filesystem I/O; LLM-driven summarization lives in the
 * caller so the store stays dependency-light and easily testable.
 */
export class StateStore {
  public readonly dir: string;
  private readonly snapshotsDir: string;

  constructor(private readonly rootDir: string) {
    this.dir = path.join(rootDir, DIR);
    this.snapshotsDir = path.join(this.dir, 'snapshots');
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  /** Whether a state store already exists for this folder. */
  async exists(): Promise<boolean> {
    return fileExists(this.file('state.json'));
  }

  /**
   * Initializes a fresh run: creates the directory, writes spec + plan, sets
   * state to RUNNING, and returns the new run state.
   */
  async init(requirement: string, criteria: { text: string; done: boolean }[]): Promise<RunState> {
    await fs.mkdir(this.snapshotsDir, { recursive: true });

    const now = new Date().toISOString();
    const state: RunState = {
      runId: uuidv4(),
      status: RunStatus.RUNNING,
      iterations: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeSpec(requirement);
    await this.writePlan({ requirement, criteria });
    await this.writeState(state);
    await this.ensureFile('context-summary.md', '# Context Summary\n\n(none yet)\n');
    await this.ensureFile('decisions.md', '# Decisions\n\n');
    await this.ensureFile('open-issues.md', '# Open Issues\n\n');

    log.info('State store initialized', { source: 'stateStore#init', dir: this.dir, runId: state.runId });
    return state;
  }

  // ── State ──
  async readState(): Promise<RunState | null> {
    return this.readJson<RunState>('state.json');
  }

  async writeState(state: RunState): Promise<void> {
    await this.writeJsonAtomic('state.json', { ...state, updatedAt: new Date().toISOString() });
  }

  async updateState(patch: Partial<RunState>): Promise<RunState> {
    const current = (await this.readState()) ?? this.emptyState();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.writeJsonAtomic('state.json', next);
    return next;
  }

  // ── Plan / criteria ──
  async readPlan(): Promise<StoredPlan | null> {
    return this.readJson<StoredPlan>('plan.json');
  }

  async writePlan(plan: StoredPlan): Promise<void> {
    await this.writeJsonAtomic('plan.json', plan);
  }

  async markCriteriaDone(doneTexts: string[]): Promise<void> {
    const plan = await this.readPlan();
    if (!plan) return;
    const done = new Set(doneTexts.map((t) => t.trim()));
    for (const c of plan.criteria) {
      if (done.has(c.text.trim())) c.done = true;
    }
    await this.writePlan(plan);
  }

  // ── Progress log (append-only JSONL) ──
  async appendProgress(event: Omit<ProgressEvent, 'ts'>): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    await fs.appendFile(this.file('progress-log.jsonl'), line + '\n', 'utf-8');
  }

  async readProgress(): Promise<ProgressEvent[]> {
    if (!(await fileExists(this.file('progress-log.jsonl')))) return [];
    const raw = await fs.readFile(this.file('progress-log.jsonl'), 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as ProgressEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is ProgressEvent => e !== null);
  }

  // ── Narrative artifacts ──
  async writeSummary(markdown: string): Promise<void> {
    await this.writeTextAtomic('context-summary.md', markdown);
  }

  async readSummary(): Promise<string> {
    return this.readText('context-summary.md');
  }

  async appendDecision(text: string): Promise<void> {
    await fs.appendFile(this.file('decisions.md'), `\n- ${text}\n`, 'utf-8');
  }

  async appendOpenIssue(text: string): Promise<void> {
    await fs.appendFile(this.file('open-issues.md'), `\n- ${text}\n`, 'utf-8');
  }

  async writeSpec(requirement: string): Promise<void> {
    await this.writeTextAtomic('spec.md', `# Task Spec\n\n${requirement}\n`);
  }

  // ── Project map cache ──
  async readProjectMap(): Promise<ProjectMap | null> {
    return this.readJson<ProjectMap>('project-map.json');
  }

  async writeProjectMap(map: ProjectMap): Promise<void> {
    await this.writeJsonAtomic('project-map.json', map);
  }

  // ── Snapshots (non-git undo) ──
  /**
   * Copies a file's current content into `snapshots/<runId>/` before it's
   * overwritten or deleted, keyed by relative path. Best-effort; never throws
   * into the caller's write path.
   */
  async snapshotFile(relPath: string, absPath: string, runId: string): Promise<void> {
    try {
      if (!(await fileExists(absPath))) return;
      const dest = resolveInsideRoot(path.join(this.snapshotsDir, runId), relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(absPath, dest);
    } catch (error: unknown) {
      log.warn('Snapshot failed', {
        source: 'stateStore#snapshotFile',
        relPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── Onboarding packet (resume) ──
  async buildOnboardingPacket(): Promise<OnboardingPacket> {
    const plan = await this.readPlan();
    const state = await this.readState();
    return {
      requirement: plan?.requirement ?? '',
      pendingCriteria: (plan?.criteria ?? []).filter((c) => !c.done).map((c) => c.text),
      doneCriteria: (plan?.criteria ?? []).filter((c) => c.done).map((c) => c.text),
      summary: await this.readSummary(),
      openIssues: await this.readText('open-issues.md'),
      decisions: await this.readText('decisions.md'),
      priorIterations: state?.iterations ?? 0,
    };
  }

  // ── Lockfile (single active run per folder) ──
  /**
   * Acquires the run lock. If a lock exists but its owning process is dead
   * (stale lock), it is reclaimed. Throws if a live process holds it.
   */
  async acquireLock(): Promise<void> {
    const lockPath = this.file('.lock');
    if (await fileExists(lockPath)) {
      const holder = await this.readJson<{ pid: number }>('.lock');
      if (holder && isProcessAlive(holder.pid)) {
        throw new Error('Another NeuroStack run is active on this folder (lock held).');
      }
      log.warn('Reclaiming stale lock', { source: 'stateStore#acquireLock' });
    }
    await this.writeJsonAtomic('.lock', { pid: process.pid, at: new Date().toISOString() });
  }

  async releaseLock(): Promise<void> {
    await fs.rm(this.file('.lock'), { force: true }).catch(() => { /* best effort */ });
  }

  // ── Internal helpers ──
  private emptyState(): RunState {
    const now = new Date().toISOString();
    return { runId: uuidv4(), status: RunStatus.RUNNING, iterations: 0, createdAt: now, updatedAt: now };
  }

  private async readJson<T>(name: string): Promise<T | null> {
    if (!(await fileExists(this.file(name)))) return null;
    try {
      return JSON.parse(await fs.readFile(this.file(name), 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  private async readText(name: string): Promise<string> {
    if (!(await fileExists(this.file(name)))) return '';
    return fs.readFile(this.file(name), 'utf-8');
  }

  private async ensureFile(name: string, initial: string): Promise<void> {
    if (!(await fileExists(this.file(name)))) await this.writeTextAtomic(name, initial);
  }

  private async writeJsonAtomic(name: string, data: unknown): Promise<void> {
    await this.writeTextAtomic(name, JSON.stringify(data, null, 2));
  }

  private async writeTextAtomic(name: string, content: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(name);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, content, 'utf-8');
    await fs.rename(temp, target);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
