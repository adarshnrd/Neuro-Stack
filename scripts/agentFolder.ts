/**
 * NeuroStack folder agent — CLI entry (Phases A, B, D).
 *
 * Opens a local folder and runs the autonomous agent loop directly inside it,
 * tracking durable state under `<folder>/.neurostack/` so a run survives a
 * crash/exit/model-exhaustion and can be resumed.
 *
 * Usage:
 *   npx tsx scripts/agentFolder.ts <folder> "<prompt>" [--manual]   Start a run
 *   npx tsx scripts/agentFolder.ts resume <folder> [--manual]       Resume a run
 *   npx tsx scripts/agentFolder.ts status <folder>                  Show run status
 *
 *   --manual   Ask before EVERY command (default: auto — only high-risk commands ask)
 */
import readline from 'readline';
import { runFolderAgent, resumeFolderAgent, getFolderStatus } from '../src/services/folderAgentService.js';
import { PermissionMode } from '../src/enums/workspaceEnum.js';
import { ApprovalRequest } from '../src/types/workspaceTypes.js';

/** Readline-based approval broker: prompts the user to allow/deny a command. */
function createCliBroker(): (req: ApprovalRequest) => Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return (req: ApprovalRequest) =>
    new Promise<boolean>((resolve) => {
      console.log(`\n⚠️  Approval needed [${req.risk}] — ${req.reason}`);
      rl.question(`   Run: ${req.command}\n   Allow? [y/N] `, (answer) => {
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
}

function printResult(result: { rounds: number; toolCallCount: number; hitRoundCap: boolean; handoffCount: number; status: string; content: string }): void {
  console.log('\n─────────────── Result ───────────────');
  console.log(`Status: ${result.status} · Rounds: ${result.rounds} · Tool calls: ${result.toolCallCount} · Handoffs: ${result.handoffCount} · Hit cap: ${result.hitRoundCap}`);
  console.log(`\n${result.content}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manual = argv.includes('--manual');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const permissionMode = manual ? PermissionMode.MANUAL : PermissionMode.AUTO;

  try {
    // status <folder>
    if (positional[0] === 'status') {
      if (!positional[1]) throw new Error('Usage: status <folder>');
      console.log(await getFolderStatus(positional[1]));
      process.exit(0);
    }

    // resume <folder>
    if (positional[0] === 'resume') {
      if (!positional[1]) throw new Error('Usage: resume <folder> [--manual]');
      console.log(`\n▶ Resuming: ${positional[1]}  (${manual ? 'manual' : 'auto'})\n`);
      const result = await resumeFolderAgent(positional[1], { permissionMode, approvalBroker: createCliBroker() });
      printResult(result);
      process.exit(0);
    }

    // <folder> "<prompt>"
    const [folder, prompt] = positional;
    if (!folder || !prompt) {
      console.error('Usage:\n  agentFolder <folder> "<prompt>" [--manual]\n  agentFolder resume <folder> [--manual]\n  agentFolder status <folder>');
      process.exit(1);
    }

    console.log(`\n▶ Folder: ${folder}`);
    console.log(`▶ Mode:   ${manual ? 'manual (approve every command)' : 'auto (approve high-risk only)'}\n`);
    const result = await runFolderAgent(folder, prompt, { permissionMode, approvalBroker: createCliBroker() });
    printResult(result);
    process.exit(process.exitCode ?? 0);
  } catch (error: unknown) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
