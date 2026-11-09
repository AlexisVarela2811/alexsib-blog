import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
// @ts-expect-error Node requires the extension.
import { createAuthComposition } from '../src/lib/auth/composition.ts';

const origin = 'https://example.test';
const password = 'synthetic password';
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const hash = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const passwordHash = `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const config = { origin, username: 'admin', passwordHash, sessionSecret: secret };

async function database() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8'));
  return client;
}

test('real primitives issue a cookie, authorize reads and origin-bound writes, and logout', async () => {
  const db = await database();
  try {
    const auth = createAuthComposition(config, db);
    const cookie = await auth.login('admin', password, origin);
    assert.ok(cookie);
    assert.match(cookie, /^__Host-admin=[A-Za-z0-9._-]+; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);
    assert.equal(await auth.authorizeRead(cookie), true);
    assert.equal(await auth.authorize(cookie, origin), true);
    assert.equal(await auth.authorize(cookie, 'https://evil.test'), false);
    assert.equal(auth.logout(origin), '__Host-admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
    assert.equal(auth.logout('https://evil.test'), null);
    assert.equal(await auth.authorizeRead(`${cookie}; __Host-admin=x`), false);
    const rotated = createAuthComposition({ ...config, sessionSecret: Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i)).toString('base64') }, db);
    assert.equal(await rotated.authorizeRead(cookie), false);
  } finally { db.close(); }
});

test('throttle limits failed and malformed login attempts, and database failures fail closed', async () => {
  const db = await database();
  try {
    const auth = createAuthComposition(config, db);
    assert.equal(await auth.login('admin', 'wrong', origin), null);
    assert.equal(await auth.login(null, null, origin), null);
    for (let i = 0; i < 3; i++) assert.equal(await auth.login('wrong', password, origin), null);
    assert.equal(await auth.login('admin', password, origin), null);
    const row = await db.execute('SELECT attempts FROM login_throttle WHERE id = 1');
    assert.equal(row.rows[0].attempts, 5);
    db.close();
    assert.equal(await auth.login('admin', password, origin), null);
  } finally { db.close(); }
});

test('missing or malformed configuration fails closed without consuming attempts', async () => {
  const db = await database();
  try {
    const valid = createAuthComposition(config, db);
    const cookie = await valid.login('admin', password, origin);
    assert.ok(cookie);
    for (const invalid of [undefined, null, {}, { ...config, origin: 'http://example.test' }, { ...config, username: '' }, { ...config, passwordHash: 'bad' }, { ...config, sessionSecret: 'bad' }]) {
      const auth = createAuthComposition(invalid, db);
      assert.equal(await auth.login('admin', password, origin), null);
      assert.equal(await auth.authorizeRead(cookie), false);
      assert.equal(await auth.authorize(cookie, origin), false);
      assert.equal(auth.logout(origin), null);
    }
    const row = await db.execute('SELECT attempts FROM login_throttle WHERE id = 1');
    assert.equal(row.rows[0].attempts, 1);
    assert.equal(await valid.login('admin', password, 'https://evil.test'), null);
    assert.equal((await db.execute('SELECT attempts FROM login_throttle WHERE id = 1')).rows[0].attempts, 1);
  } finally { db.close(); }
});
