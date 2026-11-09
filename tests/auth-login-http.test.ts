import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
// @ts-expect-error Node requires the extension.
import { createAuthComposition } from '../src/lib/auth/composition.ts';
// @ts-expect-error Node requires the extension.
import { loginHttp } from '../src/lib/auth/login-http.ts';

const origin = 'https://example.test';
const password = 'synthetic password';
const salt = Buffer.alloc(16, 1);
const config = { origin, username: 'admin', passwordHash: `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`, sessionSecret: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64') };
async function fixture() {
  const db = createClient({ url: 'file::memory:' });
  await db.executeMultiple(await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8'));
  return { db, auth: createAuthComposition(config, db) };
}
function request(body = 'username=admin&password=synthetic+password', headers: Record<string, string> = { origin }): Request {
  return new Request('https://example.test/login?next=https://evil.test', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });
}
async function failed(response: Response) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), 'Login failed');
}

test('successful synthetic login issues boundary cookie and fixed local redirect', async () => {
  const { db, auth } = await fixture();
  try {
    const res = await loginHttp(request(), auth);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/admin');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('set-cookie') ?? '', /^__Host-admin=[A-Za-z0-9._-]+; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);
  } finally { db.close(); }
});

test('rejects origins, malformed forms, methods and media types generically without consuming attempts', async () => {
  const { db, auth } = await fixture();
  try {
    const cases = [request(undefined, { origin: 'https://evil.test', host: 'example.test', 'x-forwarded-host': 'example.test' }), request(undefined, { origin: '' }), request('username=admin&password=%'), request('username=admin&password=%FF'), request('username=admin&username=admin&password=x'), request('username=admin'), request('username=admin&password=x&password=y'), request('username=admin&password=x', { 'content-type': 'text/plain' }), new Request('https://example.test/login', { method: 'GET' }), request('x'.repeat(5000))];
    for (const req of cases) await failed(await loginHttp(req, auth));
    assert.equal((await db.execute('SELECT attempts FROM login_throttle WHERE id = 1')).rows[0].attempts, 0);
  } finally { db.close(); }
});

test('exhaustion and database failures remain generic and fail closed', async () => {
  const { db, auth } = await fixture();
  try {
    for (let i = 0; i < 5; i++) await failed(await loginHttp(request('username=admin&password=wrong'), auth));
    await failed(await loginHttp(request(), auth));
    assert.equal((await db.execute('SELECT attempts FROM login_throttle WHERE id = 1')).rows[0].attempts, 5);
    db.close();
    await failed(await loginHttp(request(), auth));
  } finally { db.close(); }
});

test('bounded streaming stops reading and exceptions never leak', async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(5000)); } });
  const req = new Request('https://example.test/login', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: stream, duplex: 'half' } as RequestInit);
  const { db, auth } = await fixture();
  try {
    await failed(await loginHttp(req, auth));
    assert.ok(pulls <= 2);
    await failed(await loginHttp(request(), { ...auth, login: async () => { throw Error('secret exception'); } }));
  } finally { db.close(); }
});
