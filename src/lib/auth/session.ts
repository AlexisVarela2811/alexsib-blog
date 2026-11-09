import { SignJWT, jwtVerify } from 'jose';

const SESSION_SECONDS = 8 * 60 * 60;

// SESSION_SECRET must be canonical base64 encoding of 32 cryptographically random
// bytes. Length/format checks cannot prove entropy: generate it securely. Rotate
// this key to invalidate every existing session; password rotation must also rotate it.
function sessionKey(config: unknown): Uint8Array {
  if (typeof window !== 'undefined') throw new Error('Server only');
  const secret = config && typeof config === 'object' ? (config as { secret?: unknown }).secret : undefined;
  if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error('Invalid session secret');
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32 || key.toString('base64') !== secret || new Set(key).size < 2) {
    throw new Error('Invalid session secret');
  }
  return key;
}

/** Sign only after credentials have been verified on the server. JWTs are not encrypted. */
export async function createAdminSessionWithConfig(config: unknown): Promise<string> {
  const key = sessionKey(config);
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('admin')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_SECONDS)
    .sign(key);
}

/** Fail closed for invalid configuration and all invalid or expired tokens. */
export async function verifyAdminSessionWithConfig(config: unknown, token: string): Promise<boolean> {
  try {
    const key = sessionKey(config);
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], requiredClaims: ['sub', 'iat', 'exp'] });
    const now = Math.floor(Date.now() / 1000);
    return payload.sub === 'admin' && Number.isSafeInteger(payload.iat) &&
      Number.isSafeInteger(payload.exp) && payload.iat! <= now &&
      payload.exp! > payload.iat! && payload.exp! - payload.iat! <= SESSION_SECONDS;
  } catch {
    return false;
  }
}

/** Legacy environment-backed interfaces. */
export async function createAdminSession(): Promise<string> {
  if (typeof window !== 'undefined') throw new Error('Server only');
  return createAdminSessionWithConfig({ secret: process.env.SESSION_SECRET });
}

export async function verifyAdminSession(token: string): Promise<boolean> {
  if (typeof window !== 'undefined') return false;
  return verifyAdminSessionWithConfig({ secret: process.env.SESSION_SECRET }, token);
}
