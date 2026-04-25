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
 * Description for the @REVIEW command.
 */
export const REVIEW_COMMAND_DESCRIPTION: string = 'Review pending code changes in the visual diff viewer.';
