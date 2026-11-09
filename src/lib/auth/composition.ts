import type { Client } from '@libsql/client';
// @ts-expect-error Native Node TypeScript imports require an extension.
import { createAuthBoundary } from './boundary.ts';
// @ts-expect-error Native Node TypeScript imports require an extension.
import { verifyAdminCredentialsWithConfig } from './credentials.ts';
// @ts-expect-error Native Node TypeScript imports require an extension.
import { createAdminSessionWithConfig, verifyAdminSessionWithConfig } from './session.ts';
// @ts-expect-error Native Node TypeScript imports require an extension.
import { consumeLoginAttempt } from './throttle.ts';

// Validate all configuration before allowing even session-only reads. These checks
// mirror the primitive formats; the primitives remain the authority for verification.
function canonicalBase64(value: string, bytes: number): boolean {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === bytes && decoded.toString('base64') === value;
}

function validConfig(value: unknown): value is { origin: string; username: string; passwordHash: string; sessionSecret: string } {
  if (!value || typeof value !== 'object') return false;
  const { origin, username, passwordHash, sessionSecret } = value as Record<string, unknown>;
  if (typeof origin !== 'string' || typeof username !== 'string' || !username ||
      Buffer.byteLength(username, 'utf8') > 128 || typeof passwordHash !== 'string' ||
      typeof sessionSecret !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) return false;
    const parts = passwordHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt' || !canonicalBase64(parts[1], 16) || !canonicalBase64(parts[2], 32)) return false;
    return canonicalBase64(sessionSecret, 32) && new Set(Buffer.from(sessionSecret, 'base64')).size >= 2;
  } catch { return false; }
}

/** Internal server composition only. Do not expose routes before security proof. */
export function createAuthComposition(config: unknown, db: Client) {
  const valid = typeof window === 'undefined' && validConfig(config) && !!db && typeof db.execute === 'function';
  const settings = valid ? { ...config } : null;
  return createAuthBoundary({
    origin: settings?.origin ?? '',
    consumeAttempt: () => consumeLoginAttempt(db),
    verifyCredentials: (username, password) => verifyAdminCredentialsWithConfig(
      { username: settings?.username, passwordHash: settings?.passwordHash }, username, password),
    createSession: () => createAdminSessionWithConfig({ secret: settings?.sessionSecret }),
    verifySession: token => verifyAdminSessionWithConfig({ secret: settings?.sessionSecret }, token),
  });
}
