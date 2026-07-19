/**
 * Markdown usage guide returned when @AGENT is invoked without a requirement.
 */
export const AGENT_USAGE_GUIDE: string = [
  '## ⚡ @AGENT — Usage',
  '',
  'Please provide a requirement description after `@AGENT`:',
  '',
  '```',
  '@AGENT Create a user authentication system with JWT tokens',
  '```',
  '',
  '**Workflow:**',
  '1. Analyzes your requirement',
  '2. Asks clarifying questions (if needed)',
  '3. Generates a structured technical plan',
  '4. Waits for your approval',
  '5. Generates production-ready code',
  '6. Suggests creating a PR with `@CREATE_PR`',
].join('\n');

/**
 * Description for the @AGENT command.
 */
export const AGENT_COMMAND_DESCRIPTION: string = 'Analyze a requirement and generate production-ready code with a structured plan.';

/**
 * System-prompt section describing the workspace tools available to the
 * @AGENT tool loop and the rules for using them.
 */
export const AGENT_TOOL_GUIDANCE: string = [
  '## Tool Usage',
  'You have tools to explore and modify the workspace: `list_directory`, `read_file`, `write_file`, `delete_file`.',
  '- Ground every change in reality: list and read the relevant files BEFORE writing.',
  '- `write_file` replaces the entire file — always write complete file contents.',
  '- File writes are STAGED for human review. Never claim changes are applied; say they await review.',
  '- If a tool returns an error, adjust your approach and continue rather than giving up.',
  '- When finished, summarize what you changed and why.',
].join('\n');

/**
 * Description for the @REVIEW command.
 */
export const REVIEW_COMMAND_DESCRIPTION: string = 'Review pending code changes in the visual diff viewer.';
