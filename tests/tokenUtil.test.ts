import { describe, it, expect } from 'vitest';
import { createSignedToken, verifySignedToken } from '../src/utils/tokenUtil';

const SECRET = 'unit-test-secret';

describe('tokenUtil', () => {
  it('round-trips a valid token', () => {
    const token = createSignedToken('user-123', 3600, SECRET);
    expect(verifySignedToken(token, SECRET)).toBe('user-123');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSignedToken('user-123', 3600, SECRET);
    expect(verifySignedToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createSignedToken('user-123', 3600, SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ userId: 'admin', exp: 9999999999 })).toString('base64url');
    expect(verifySignedToken(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSignedToken('user-123', -10, SECRET);
    expect(verifySignedToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifySignedToken('', SECRET)).toBeNull();
    expect(verifySignedToken('not-a-token', SECRET)).toBeNull();
    expect(verifySignedToken('a.b.c', SECRET)).toBeNull();
    // A raw user UUID (the old token format) must no longer authenticate
    expect(verifySignedToken('9c2c6ff7-84a1-4e0a-8fe3-0bffa630e402', SECRET)).toBeNull();
  });
});
