import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { changeSetContext } from '../services/changeSetContext.js';
import { allowedCheckNames, runChecks } from '../services/verificationService.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('verifyTools');

/**
 * Lets the coder run allowlisted checks (typecheck / test / lint) against its
 * own staged changes in a sandbox and read the real output — the objective
 * feedback signal that keeps the loop honest.
 */
export const runCheckTool = tool(
  async ({ checks }) => {
    const changeSetId = changeSetContext.getStore();
    if (!changeSetId) return 'No active changeset — nothing to verify.';

    log.info('Tool executed: Run Check', { source: 'verifyTools#runCheckTool', checks });
    const result = await runChecks(changeSetId, checks ?? []);
    return `Checks run: ${result.ran.join(', ') || 'none'}\nAll passed: ${result.allPassed}\n\n${result.output}`;
  },
  {
    name: 'run_check',
    description:
      `Run verification checks against your staged changes and get the real output. ` +
      `Allowed checks: ${allowedCheckNames().join(', ')}. A syntax check of changed JS files always runs. ` +
      `Use this to confirm your work before finishing.`,
    schema: z.object({
      checks: z
        .array(z.enum(['typecheck', 'test', 'lint']))
        .optional()
        .describe('Named checks to run in addition to the always-on syntax check'),
    }),
  },
);
