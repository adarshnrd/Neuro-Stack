import { describe, it, expect } from 'vitest';
import { truncateText, isUuid } from '../src/utils/stringUtil.js';

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates long text with an ellipsis within the limit', () => {
    const result = truncateText('a'.repeat(100), 50);
    expect(result).toHaveLength(50);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs', () => {
    expect(isUuid('3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c')).toBe(true);
  });
  it('rejects anything else', () => {
    for (const value of ['', 'abc', '3f2b8c1e9a4d4e7b8c2a1d5e6f7a8b9c', "1' OR '1'='1", undefined, 42]) {
      expect(isUuid(value), String(value)).toBe(false);
    }
  });
});
