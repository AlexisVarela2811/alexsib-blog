import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, decodeJwt } from 'jose';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSession, verifyAdminSession } from '../src/lib/auth/session.ts';

// Deterministic public test vectors only; never use these as real secrets.
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const rotated = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i)).toString('base64');

async function signed(claims: Record<string, unknown>, alg = 'HS256') {
  return new SignJWT(claims).setProtectedHeader({ alg }).sign(Buffer.from(key, 'base64'));
}

test('issues a bounded admin token and rejects expiry at its boundary', async () => {
  process.env.SESSION_SECRET = key;
  const token = await createAdminSession();
  const payload = decodeJwt(token);
  assert.equal(payload.sub, 'admin');
  assert.equal(payload.exp! - payload.iat!, 8 * 60 * 60);
  assert.equal(await verifyAdminSession(token), true);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyAdminSession(await signed({ sub: 'admin', iat: now - 1, exp: now })), false);
  assert.equal(await verifyAdminSession(await signed({ sub: 'admin', iat: now - 1, exp: now + 60 })), true);
});

test('rejects tampering, malformed tokens and invalid claims', async () => {
  process.env.SESSION_SECRET = key;
  const token = await createAdminSession();
  const parts = token.split('.');
  parts[1] = Buffer.from('{"sub":"other"}').toString('base64url');
  assert.equal(await verifyAdminSession(parts.join('.')), false);
  assert.equal(await verifyAdminSession('invalid'), false);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { sub: 'admin', iat: now },
    { sub: 'other', iat: now, exp: now + 60 },
    { sub: 'admin', iat: now + 60, exp: now + 120 },
    { sub: 'admin', iat: now, exp: now + 8 * 60 * 60 + 1 },
  ]) assert.equal(await verifyAdminSession(await signed(claims)), false);
  assert.equal(await verifyAdminSession(await signed({ sub: 'admin', iat: now, exp: now + 60 }, 'HS384')), false);
});

test('fails closed for missing or weak configuration and invalidates tokens on rotation', async () => {
  process.env.SESSION_SECRET = key;
  const token = await createAdminSession();
  for (const secret of [undefined, '', 'short', Buffer.alloc(32).toString('base64')]) {
    if (secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = secret;
    await assert.rejects(createAdminSession(), /Invalid session secret/);
    assert.equal(await verifyAdminSession(token), false);
  }
  process.env.SESSION_SECRET = rotated;
  assert.equal(await verifyAdminSession(token), false);
  assert.equal(await verifyAdminSession(await createAdminSession()), true);
  delete process.env.SESSION_SECRET;
});
