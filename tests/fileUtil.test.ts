import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveInsideRoot } from '../src/utils/fileUtil';

const ROOT = path.resolve('/tmp/neurostack-workspace');

describe('resolveInsideRoot', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInsideRoot(ROOT, 'src/index.ts')).toBe(path.join(ROOT, 'src/index.ts'));
    expect(resolveInsideRoot(ROOT, './a/../b.txt')).toBe(path.join(ROOT, 'b.txt'));
  });

  it('allows the root itself', () => {
    expect(resolveInsideRoot(ROOT, '.')).toBe(ROOT);
  });

  it('blocks parent-directory traversal', () => {
    expect(() => resolveInsideRoot(ROOT, '../outside.txt')).toThrow(/escapes/);
    expect(() => resolveInsideRoot(ROOT, 'a/../../outside.txt')).toThrow(/escapes/);
    expect(() => resolveInsideRoot(ROOT, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('blocks absolute paths outside the root', () => {
    expect(() => resolveInsideRoot(ROOT, '/etc/passwd')).toThrow(/escapes/);
  });

  it('blocks sibling directories with a shared prefix', () => {
    expect(() => resolveInsideRoot(ROOT, '../neurostack-workspace-evil/x')).toThrow(/escapes/);
  });
});
