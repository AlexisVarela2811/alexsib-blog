import { createHash, scrypt, timingSafeEqual } from 'node:crypto';

// ADMIN_USERNAME: 1–128 UTF-8 bytes. ADMIN_PASSWORD_HASH: scrypt$<salt>$<key>,
// with canonical padded base64 encoding of a random 16-byte salt and 32-byte
// key. Derive the key with scrypt N=32768, r=8, p=1, maxmem=64 MiB.
// Generate the salt securely and use a strong unique password; never commit either.
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxBytes &&
    Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function decode(value: string, bytes: number): Buffer | null {
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === bytes && decoded.toString('base64') === value ? decoded : null;
}

/** Server-side verification only; this does not implement login or rate limiting. */
export async function verifyAdminCredentials(username: unknown, password: unknown): Promise<boolean> {
  if (typeof window !== 'undefined') return false;
  const configuredUser = process.env.ADMIN_USERNAME;
  const encoded = process.env.ADMIN_PASSWORD_HASH;
  if (!boundedString(configuredUser, 128) || !boundedString(username, 128) ||
      !boundedString(password, 1024) || !boundedString(encoded, 128)) return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = decode(parts[1], 16);
  const expected = decode(parts[2], 32);
  if (!salt || !expected) return false;

  try {
    const actual = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key));
    });
    // Hash usernames to equal-sized buffers before the timing-safe comparison.
    const userMatches = timingSafeEqual(createHash('sha256').update(username).digest(),
      createHash('sha256').update(configuredUser).digest());
    const passwordMatches = timingSafeEqual(actual, expected);
    return userMatches && passwordMatches;
  } catch {
    return false;
  }
}
