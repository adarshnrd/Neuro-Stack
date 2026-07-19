import { describe, it, expect } from 'vitest';
import { Request } from 'express';
import { getCookie } from '../src/utils/cookieUtil';

function reqWithCookie(cookie?: string): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as Request;
}

describe('getCookie', () => {
  it('reads a single cookie', () => {
    expect(getCookie(reqWithCookie('neurostack_token=abc123'), 'neurostack_token')).toBe('abc123');
  });

  it('reads from multiple cookies with whitespace', () => {
    expect(getCookie(reqWithCookie('theme=dark; neurostack_token=xyz; lang=en'), 'neurostack_token')).toBe('xyz');
  });

  it('does not match cookies whose name merely starts the same', () => {
    expect(getCookie(reqWithCookie('neurostack_token_old=stale; neurostack_token=fresh'), 'neurostack_token')).toBe('fresh');
  });

  it('preserves values containing = signs', () => {
    expect(getCookie(reqWithCookie('neurostack_token=abc=def'), 'neurostack_token')).toBe('abc=def');
  });

  it('returns undefined when absent', () => {
    expect(getCookie(reqWithCookie(), 'neurostack_token')).toBeUndefined();
    expect(getCookie(reqWithCookie('other=1'), 'neurostack_token')).toBeUndefined();
  });
});
