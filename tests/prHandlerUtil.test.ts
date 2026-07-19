import { describe, it, expect } from 'vitest';
import {
  requireGitHubConfig,
  readPrNumber,
  missingPrNumberResult,
  branchSlug,
  toErrorResult,
} from '../src/commands/handlers/prHandlerUtil.js';

describe('requireGitHubConfig', () => {
  it('returns a failure result naming the missing vars when GitHub is not configured', () => {
    const result = requireGitHubConfig();
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/Git configuration is missing/i);
    expect(result?.message).toContain('GITHUB_OWNER');
    expect(result?.message).toContain('GITHUB_REPO');
    expect(result?.message).toContain('GITHUB_TOKEN');
  });
});

describe('readPrNumber', () => {
  it('accepts a positive integer', () => {
    expect(readPrNumber({ prNumber: 42 })).toBe(42);
  });
  it('rejects missing, zero, negative, and non-integer values', () => {
    expect(readPrNumber({})).toBeNull();
    expect(readPrNumber({ prNumber: 0 })).toBeNull();
    expect(readPrNumber({ prNumber: -3 })).toBeNull();
    expect(readPrNumber({ prNumber: 1.5 })).toBeNull();
    expect(readPrNumber({ prNumber: '42' })).toBeNull();
  });
});

describe('branchSlug', () => {
  it('produces a filesystem-safe slug', () => {
    expect(branchSlug('Add JWT Auth!')).toBe('add-jwt-auth');
  });
  it('falls back to "changes" for empty input', () => {
    expect(branchSlug('!!!')).toBe('changes');
  });
});

describe('helpers', () => {
  it('missingPrNumberResult names the command', () => {
    expect(missingPrNumberResult('MERGE_PR').message).toContain('@MERGE_PR');
  });
  it('toErrorResult wraps thrown errors', () => {
    const r = toErrorResult('PR merge', new Error('boom'));
    expect(r.success).toBe(false);
    expect(r.message).toContain('boom');
  });
});
