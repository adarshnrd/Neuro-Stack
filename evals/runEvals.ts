/**
 * Agent-loop evaluation harness.
 *
 * Runs each benchmark task in evals/tasks/ through the full agent loop
 * (auto-approve) and reports completion rate, iterations, and wall time.
 * Changes are STAGED (never written to the workspace), so runs are side-effect
 * free; verification happens in a sandbox.
 *
 * Usage: npx tsx evals/runEvals.ts [taskSlug]
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { parseTaskSpec } from '../src/services/taskSpecService.js';
import { startRun } from '../src/services/agentLoopService.js';
import { LoopRunResult, LoopStopReason } from '../src/types/agentTaskTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, 'tasks');

interface EvalRow {
  slug: string;
  stopReason: LoopStopReason | 'error';
  iterations: number;
  met: number;
  total: number;
  durationMs: number;
}

async function runTask(slug: string, markdown: string): Promise<EvalRow> {
  const spec = parseTaskSpec(slug, markdown);
  const sessionId = uuidv4();
  const startTime = Date.now();

  const gen = startRun(spec, { sessionId, autoApprove: true, verificationEnabled: true, maxIterations: 4 });

  // Drain progress events; keep the last so we can read the generator's return
  let result: LoopRunResult | undefined;
  let next = await gen.next();
  while (!next.done) {
    const evt = next.value;
    process.stdout.write(`  · ${evt.type}${evt.node ? `(${evt.node})` : ''}: ${evt.message}\n`);
    next = await gen.next();
  }
  result = next.value;

  return {
    slug,
    stopReason: result.stopReason,
    iterations: result.iterations,
    met: result.metCriteria.length,
    total: result.metCriteria.length + result.unmetCriteria.length,
    durationMs: Date.now() - startTime,
  };
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith('.md'));
  const rows: EvalRow[] = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    if (only && slug !== only) continue;

    console.log(`\n▶ ${slug}`);
    try {
      const markdown = await fs.readFile(path.join(TASKS_DIR, file), 'utf-8');
      rows.push(await runTask(slug, markdown));
    } catch (error: unknown) {
      console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      rows.push({ slug, stopReason: 'error', iterations: 0, met: 0, total: 0, durationMs: 0 });
    }
  }

  console.log('\n─────────────── Eval Summary ───────────────');
  console.log('task'.padEnd(16), 'result'.padEnd(16), 'iters', ' crit', '  time');
  for (const r of rows) {
    console.log(
      r.slug.padEnd(16),
      String(r.stopReason).padEnd(16),
      String(r.iterations).padStart(5),
      ` ${r.met}/${r.total}`.padStart(5),
      `${(r.durationMs / 1000).toFixed(1)}s`.padStart(7),
    );
  }
  const completed = rows.filter((r) => r.stopReason === LoopStopReason.COMPLETE).length;
  console.log('─────────────────────────────────────────────');
  console.log(`Completion rate: ${completed}/${rows.length}`);

  if (completed < rows.length) process.exitCode = 1;
}

main();
