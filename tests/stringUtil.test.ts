import { describe, it, expect } from 'vitest';
import { truncateText, stripCommandPrefix } from '../src/utils/stringUtil';

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

describe('stripCommandPrefix', () => {
  it('strips a matching prefix and trims', () => {
    expect(stripCommandPrefix('@AGENT build a thing', 'AGENT')).toBe('build a thing');
  });

  it('leaves non-matching messages untouched', () => {
    expect(stripCommandPrefix('build a thing', 'AGENT')).toBe('build a thing');
  });
});
