import { TaskSpec } from '../types/agentTaskTypes.js';

/** Renders the acceptance criteria as a checklist for prompts. */
export function renderCriteria(spec: TaskSpec): string {
  if (spec.criteria.length === 0) return '(none specified)';
  return spec.criteria.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n');
}

export function planPrompt(spec: TaskSpec): string {
  return [
    'You are the PLANNER for an autonomous coding agent.',
    'Produce a concise, concrete implementation plan for the task below.',
    'List the files to create or modify and the key steps. Do NOT write code — plan only.',
    '',
    `# Task: ${spec.title}`,
    '',
    spec.description,
    '',
    '## Acceptance Criteria',
    renderCriteria(spec),
  ].join('\n');
}

export function implementSystemPrompt(
  spec: TaskSpec,
  plan: string,
  reviewNotes: string,
  verificationOutput: string,
  toolGuidance: string,
): string {
  const sections = [
    'You are the CODER for an autonomous agent. Implement the task using the provided tools.',
    toolGuidance,
    '',
    `# Task: ${spec.title}`,
    spec.description,
    '',
    '## Acceptance Criteria',
    renderCriteria(spec),
    '',
    '## Approved Plan',
    plan,
  ];

  if (reviewNotes.trim()) {
    sections.push(
      '',
      '## Reviewer Findings From Last Iteration (address these now)',
      reviewNotes,
    );
  }
  if (verificationOutput.trim()) {
    sections.push('', '## Latest Verification Output', '```', verificationOutput, '```');
  }

  return sections.join('\n');
}

export function reviewPrompt(spec: TaskSpec, stagedChanges: string, verificationOutput: string): string {
  const sections = [
    'You are the REVIEWER. You did NOT write this code. Critically assess whether the staged',
    'changes below fully satisfy every acceptance criterion. Identify gaps, bugs, missing',
    'criteria, and concrete improvements. Be specific and terse.',
    '',
    `# Task: ${spec.title}`,
    spec.description,
    '',
    '## Acceptance Criteria',
    renderCriteria(spec),
    '',
    '## Staged Changes',
    stagedChanges,
  ];
  if (verificationOutput.trim()) {
    sections.push('', '## Verification Output (compiler / tests / lint)', '```', verificationOutput, '```');
  }
  return sections.join('\n');
}

export function verdictPrompt(spec: TaskSpec, reviewNotes: string, verificationOutput: string): string {
  return [
    'You are the VALIDATOR. Given the acceptance criteria and the reviewer findings, decide',
    'whether the task is COMPLETE. Respond with ONLY a JSON object, no prose, in this shape:',
    '{',
    '  "complete": boolean,',
    '  "unmetCriteria": string[],   // exact criterion texts not yet satisfied',
    '  "findings": string[],        // short bullet list of remaining issues',
    '  "reworkGuidance": string     // one paragraph telling the coder what to fix next',
    '}',
    'If verification output shows failing checks, the task is NOT complete.',
    '',
    '## Acceptance Criteria',
    renderCriteria(spec),
    '',
    '## Reviewer Findings',
    reviewNotes || '(none)',
    verificationOutput.trim() ? `\n## Verification Output\n${verificationOutput}` : '',
  ].join('\n');
}
