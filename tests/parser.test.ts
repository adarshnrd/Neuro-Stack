import { describe, it, expect } from 'vitest';
import { parseUserInput } from '../src/commands/parser';
import { CommandName } from '../src/enums/commandEnum';

describe('parseUserInput', () => {
  it('treats plain text as conversation', () => {
    const result = parseUserInput('how do refresh tokens work?');
    expect(result.isCommand).toBe(false);
    expect(result.command).toBeNull();
  });

  it('parses a known command with a requirement body', () => {
    const result = parseUserInput('@AGENT build a login form');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe(CommandName.AGENT);
    expect(result.args.requirement).toBe('build a login form');
  });

  it('is case-insensitive on the command name', () => {
    const result = parseUserInput('@agent do the thing');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe(CommandName.AGENT);
  });

  it('ignores unknown @ mentions', () => {
    const result = parseUserInput('@SOMEONE hello there');
    expect(result.isCommand).toBe(false);
  });

  it('extracts PR number and merge method flags', () => {
    const result = parseUserInput('@MERGE_PR #42 --method squash');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe(CommandName.MERGE_PR);
    expect(result.args.prNumber).toBe(42);
    expect(result.args.method).toBe('squash');
  });

  it('handles a bare command with no body', () => {
    const result = parseUserInput('@NEW_SESSION');
    expect(result.isCommand).toBe(true);
    expect(result.args.requirement).toBe('');
  });
});
