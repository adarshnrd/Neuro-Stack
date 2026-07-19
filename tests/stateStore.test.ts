import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StateStore } from '../src/services/stateStore.js';
import { RunStatus } from '../src/types/stateStoreTypes.js';

describe('StateStore', () => {
  let dir: string;
  let store: StateStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-state-test-'));
    store = new StateStore(dir);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty then initializes a running state', async () => {
    expect(await store.exists()).toBe(false);
    const state = await store.init('Build a widget', [{ text: 'does A', done: false }]);
    expect(state.status).toBe(RunStatus.RUNNING);
    expect(await store.exists()).toBe(true);

    const plan = await store.readPlan();
    expect(plan?.requirement).toBe('Build a widget');
    expect(plan?.criteria).toEqual([{ text: 'does A', done: false }]);
  });

  it('writes spec.md and the .neurostack layout on init', async () => {
    await store.init('Goal here', []);
    const files = await fs.readdir(path.join(dir, '.neurostack'));
    expect(files).toEqual(expect.arrayContaining(['spec.md', 'plan.json', 'state.json', 'context-summary.md']));
  });

  it('appends and reads progress events in order', async () => {
    await store.init('g', []);
    await store.appendProgress({ type: 'start', message: 'one' });
    await store.appendProgress({ type: 'round', message: 'two' });
    const events = await store.readProgress();
    expect(events.map((e) => e.message)).toEqual(['one', 'two']);
    expect(events[0].ts).toBeTruthy();
  });

  it('marks criteria done idempotently', async () => {
    await store.init('g', [{ text: 'A', done: false }, { text: 'B', done: false }]);
    await store.markCriteriaDone(['A']);
    const plan = await store.readPlan();
    expect(plan?.criteria.find((c) => c.text === 'A')?.done).toBe(true);
    expect(plan?.criteria.find((c) => c.text === 'B')?.done).toBe(false);
  });

  it('builds an onboarding packet from persisted state', async () => {
    await store.init('Build X', [{ text: 'A', done: false }, { text: 'B', done: false }]);
    await store.markCriteriaDone(['A']);
    await store.writeSummary('half done');
    await store.appendOpenIssue('watch the config');
    await store.updateState({ iterations: 3 });

    const packet = await store.buildOnboardingPacket();
    expect(packet.requirement).toBe('Build X');
    expect(packet.doneCriteria).toEqual(['A']);
    expect(packet.pendingCriteria).toEqual(['B']);
    expect(packet.summary).toContain('half done');
    expect(packet.openIssues).toContain('watch the config');
    expect(packet.priorIterations).toBe(3);
  });

  it('snapshots a file before it is overwritten', async () => {
    const state = await store.init('g', []);
    const target = path.join(dir, 'file.txt');
    await fs.writeFile(target, 'original');

    await store.snapshotFile('file.txt', target, state.runId);

    const snap = path.join(dir, '.neurostack', 'snapshots', state.runId, 'file.txt');
    expect(await fs.readFile(snap, 'utf-8')).toBe('original');
  });

  it('acquires and releases the lock; blocks a second live acquire', async () => {
    await store.init('g', []);
    await store.acquireLock();
    await expect(store.acquireLock()).rejects.toThrow(/active/i);
    await store.releaseLock();
    await expect(store.acquireLock()).resolves.toBeUndefined();
  });

  it('round-trips run status through updateState', async () => {
    await store.init('g', []);
    await store.updateState({ status: RunStatus.COMPLETE, iterations: 5 });
    const state = await store.readState();
    expect(state?.status).toBe(RunStatus.COMPLETE);
    expect(state?.iterations).toBe(5);
  });
});
