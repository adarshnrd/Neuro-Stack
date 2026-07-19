import crypto from 'crypto';

/**
 * Signed session tokens: base64url(JSON payload) + '.' + HMAC-SHA256 signature.
 * Stateless — no server-side session store — but unlike a raw user ID they
 * expire and cannot be forged without the signing secret.
 */

interface TokenPayload {
  userId: string;
  exp: number; // Unix epoch seconds
}

export function createSignedToken(userId: string, ttlSeconds: number, secret: string): string {
  const payload: TokenPayload = { userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Verifies signature and expiry. Returns the userId on success, null otherwise.
 */
export function verifySignedToken(token: string, secret: string): string | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as TokenPayload;
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}
