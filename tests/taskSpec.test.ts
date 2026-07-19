import { describe, it, expect } from 'vitest';
import {
  parseTaskSpec,
  serializeTaskSpec,
  slugify,
  taskSpecFromRequirement,
} from '../src/services/taskSpecService.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Add JWT Auth!')).toBe('add-jwt-auth');
  });

  it('falls back to "task" for empty input', () => {
    expect(slugify('!!!')).toBe('task');
  });
});

describe('parseTaskSpec', () => {
  it('extracts title, description, and criteria with checkbox state', () => {
    const md = [
      '# Build a widget',
      '',
      'Some description here.',
      '',
      '## Acceptance Criteria',
      '- [ ] does A',
      '- [x] does B',
    ].join('\n');

    const spec = parseTaskSpec('build-a-widget', md);
    expect(spec.title).toBe('Build a widget');
    expect(spec.description).toContain('Some description here.');
    expect(spec.criteria).toEqual([
      { text: 'does A', done: false },
      { text: 'does B', done: true },
    ]);
  });

  it('round-trips through serialize', () => {
    const md = '# T\n\nDesc\n\n## Acceptance Criteria\n\n- [ ] one\n- [x] two\n';
    const spec = parseTaskSpec('t', md);
    const reparsed = parseTaskSpec('t', serializeTaskSpec(spec));
    expect(reparsed.criteria).toEqual(spec.criteria);
    expect(reparsed.title).toBe(spec.title);
  });
});

describe('taskSpecFromRequirement', () => {
  it('derives a single criterion when none are given', () => {
    const spec = taskSpecFromRequirement('Create a login form');
    expect(spec.criteria).toHaveLength(1);
    expect(spec.criteria[0].done).toBe(false);
    expect(spec.title).toBe('Create a login form');
  });

  it('uses explicit criteria when the requirement includes a checklist', () => {
    const spec = taskSpecFromRequirement('Do stuff\n\n## Criteria\n- [ ] a\n- [ ] b');
    expect(spec.criteria).toHaveLength(2);
  });
});
