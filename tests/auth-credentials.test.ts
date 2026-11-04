import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { verifyAdminCredentials } from '../src/lib/auth/credentials.ts';

// Synthetic test vector only; never use these credentials in production.
const password = 'synthetic password';
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const hash = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const encoded = `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;

test('accepts only the configured username and password', async () => {
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD_HASH = encoded;
  assert.equal(await verifyAdminCredentials('admin', password), true);
  assert.equal(await verifyAdminCredentials('other', password), false);
  assert.equal(await verifyAdminCredentials('admin', 'wrong'), false);
  assert.equal(await verifyAdminCredentials('Admin', password), false);
});

test('fails closed for missing or malformed configuration', async () => {
  process.env.ADMIN_USERNAME = 'admin';
  for (const value of [undefined, '', password, encoded + 'x', encoded.replace('scrypt$', 'other$'), 'scrypt$AA==$AA==']) {
    if (value === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = value;
    assert.equal(await verifyAdminCredentials('admin', password), false);
  }
  process.env.ADMIN_PASSWORD_HASH = encoded;
  for (const value of [undefined, '', 'a'.repeat(129)]) {
    if (value === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = value;
    assert.equal(await verifyAdminCredentials('admin', password), false);
  }
});

test('rejects invalid or oversized input without accepting truncated credentials', async () => {
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD_HASH = encoded;
  for (const [user, pass] of [['', password], ['a'.repeat(129), password], ['admin', ''], ['admin', 'x'.repeat(1025)], ['admin', 'é'.repeat(513)]]) {
    assert.equal(await verifyAdminCredentials(user, pass), false);
  }
  assert.equal(await verifyAdminCredentials(null, password), false);
  assert.equal(await verifyAdminCredentials('admin', null), false);
});
