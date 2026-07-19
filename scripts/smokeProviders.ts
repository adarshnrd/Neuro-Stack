/**
 * Live smoke test for role-based model routing.
 * Makes one real API call per role and prints provider chain, latency, and reply.
 *
 * Usage: npx tsx scripts/smokeProviders.ts
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ModelRole } from '../src/enums/index.js';
import { invokeForRole } from '../src/llm/llmService.js';
import { resolveRoleChain } from '../src/llm/modelRouter.js';

async function main(): Promise<void> {
  for (const role of Object.values(ModelRole)) {
    const chain = resolveRoleChain(role)
      .map((entry) => entry.provider)
      .join(' → ');

    const startTime = Date.now();
    try {
      const reply = await invokeForRole(role, [
        new SystemMessage('Answer in five words or fewer.'),
        new HumanMessage('Say ready.'),
      ]);
      console.log(`${role.padEnd(11)} [${chain}] ${Date.now() - startTime}ms → ${reply.slice(0, 80)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${role.padEnd(11)} [${chain}] FAILED → ${message}`);
      process.exitCode = 1;
    }
  }
}

main();
