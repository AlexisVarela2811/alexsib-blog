import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDatabasePrivateComposition, createPrivateComposition } from '../src/lib/editorial/private-composition.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { findPublicMedia } from '../src/lib/media/membership.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { IntentUploadError } from '../src/lib/uploads/intent-upload.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAuthBoundary } from '../src/lib/auth/boundary.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAuthComposition } from '../src/lib/auth/composition.ts';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const article = { id: 'draft', slug: 'draft', title: 'Draft', excerpt: 'Excerpt', content: 'Content', tags: [], coverImage: null, status: 'draft' as const, createdAt: 'now', updatedAt: 'now', publishedAt: null };
function setup(cookie: unknown, origin: unknown, verifySession = async () => true) {
  const calls: string[] = [];
  const auth = createAuthBoundary({ origin: 'https://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'token', verifySession });
  const persistence = {
    list: async () => { calls.push('list'); return [article]; }, read: async () => { calls.push('read'); return article; },
    create: async () => { calls.push('create'); return article; }, edit: async () => { calls.push('edit'); return article; },
    publish: async () => { calls.push('publish'); return article; }, unpublish: async () => { calls.push('unpublish'); return article; },
  };
  const service = createPrivateComposition({ auth, cookie, origin, persistence,
    put: async () => { calls.push('put'); }, register: async () => { calls.push('register'); }, token: 'test-token' });
  return { service, calls };
}

test('valid session and origin authorize mutations and private upload', async () => {
  const { service, calls } = setup('__Host-admin=token', 'https://example.test');
  await service.editorial.create({});
  await service.editorial.publish('draft');
  await service.editorial.unpublish('draft');
  const result = await service.upload({ postId: 'draft', mime: 'image/png', stream: (async function* () { yield png; })() });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls, ['create', 'publish', 'unpublish', 'put', 'register']);
});

test('invalid origin, session and verifier failures prevent mutations and stream consumption', async () => {
  for (const [cookie, origin, verify] of [
    ['__Host-admin=token', 'https://evil.test', async () => true],
    ['__Host-admin=bad', 'https://example.test', async () => false],
    ['__Host-admin=token', 'https://example.test', async () => { throw new Error('secret'); }],
  ] as const) {
    const { service, calls } = setup(cookie, origin, verify);
    let consumed = false;
    await assert.rejects(service.editorial.create({}), { message: 'Unauthorized' });
    await assert.rejects(service.upload({ postId: 'draft', mime: 'image/png', stream: (async function* () { consumed = true; yield png; })() }), { message: 'Unauthorized' });
    assert.equal(consumed, false);
    assert.deepEqual(calls, []);
  }
});

test('database composition protects uploads and follows publication media lifecycle', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.executeMultiple(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0002_media.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0003_upload_intent.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0004_upload_reservations.sql', 'utf8')); 
    const db = drizzle(client);
    const stored = new Map<string, Buffer>();
    const put = async (path: string, body: Buffer) => { stored.set(path, body); };
    const auth = createAuthBoundary({ origin: 'https://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'token', verifySession: async () => true });
    const deps = { db, auth, cookie: '__Host-admin=token', origin: 'https://example.test', put, token: 'test-token' };
    const service = createDatabasePrivateComposition(deps);
    const input = { slug: 'composition', title: 'Title', excerpt: 'Excerpt', content: 'Text', tags: [], coverImage: null };
    const draft = await service.editorial.create(input);
    const denied = createDatabasePrivateComposition({ ...deps, origin: 'https://evil.test' });
    let consumed = false;
    await assert.rejects(denied.upload({ postId: draft.id, mime: 'image/png', stream: (async function* () { consumed = true; yield png; })() }), { message: 'Unauthorized' });
    assert.equal(consumed, false);
    assert.equal(stored.size, 0);
    assert.equal((await client.execute('SELECT * FROM upload_intents')).rows.length, 0);

    const uploaded = await service.upload({ postId: draft.id, mime: 'image/png', stream: (async function* () { yield png; })() });
    assert.equal(stored.size, 1);
    const [path] = stored.keys();
    const intents = (await client.execute('SELECT * FROM upload_intents')).rows;
    assert.equal(intents.length, 1);
    assert.equal(intents[0].state, 'registered');
    assert.equal(intents[0].media_id, uploaded.id);
    assert.equal(intents[0].storage_path, path);
    assert.equal((await client.execute('SELECT * FROM media')).rows.length, 1);
    assert.equal(await findPublicMedia(db, uploaded.id), null);
    await service.editorial.edit(draft.id, { ...input, content: `![image](/media/${uploaded.id})` });
    await service.editorial.publish(draft.id);
    assert.equal((await findPublicMedia(db, uploaded.id))?.storagePath, path);

    let failure: unknown;
    try {
      await service.upload({ postId: draft.id, mime: 'image/png', stream: (async function* () { yield png; })() });
      assert.fail('published post upload should require reconciliation');
    } catch (error) { failure = error; }
    assert.ok(failure instanceof IntentUploadError);
    assert.equal(failure.message, 'Upload requires reconciliation');
    assert.equal(failure.operation, 'create');
    assert.equal(failure.identity.postId, draft.id);
    assert.equal(stored.size, 1);
    assert.equal(await findPublicMedia(db, failure.identity.mediaId), null);
    await service.editorial.unpublish(draft.id);
    assert.equal(await findPublicMedia(db, uploaded.id), null);
    assert.equal(stored.has(path), true);
  } finally { client.close(); }
});

test('ambiguous provider failure retains prepared intent without registration', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    const db = drizzle(client);
    const auth = createAuthBoundary({ origin: 'https://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'token', verifySession: async () => true });
    const stored = new Map<string, Buffer>();
    const service = createDatabasePrivateComposition({ db, auth, cookie: '__Host-admin=token', origin: 'https://example.test', token: 'test', put: async (path, bytes) => { stored.set(path, bytes); throw Error('lost response'); } });
    const draft = await service.editorial.create({ slug: 'ambiguous', title: 'Title', excerpt: 'Excerpt', content: 'Text', tags: [], coverImage: null });
    await assert.rejects(service.upload({ postId: draft.id, mime: 'image/png', stream: (async function* () { yield png; })() }), (error: unknown) => error instanceof IntentUploadError && error.operation === 'put');
    const rows = (await client.execute('SELECT * FROM upload_intents')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'prepared');
    assert.equal(stored.size, 1);
    assert.equal((await client.execute('SELECT * FROM media')).rows.length, 0);
  } finally { client.close(); }
});

test('private reads require a validated session but not an origin', async () => {
  for (const origin of [undefined, 'https://evil.test']) {
    const { service, calls } = setup('__Host-admin=token', origin);
    assert.deepEqual(await service.editorial.list(), [article]);
    assert.deepEqual(await service.editorial.read('draft'), article);
    await assert.rejects(service.editorial.create({}), { message: 'Unauthorized' });
    assert.deepEqual(calls, ['list', 'read']);
  }
  for (const [cookie, verify] of [[null, async () => true], ['__Host-admin=x; __Host-admin=x', async () => true], ['__Host-admin=expired', async () => false], ['__Host-admin=x', async () => { throw Error('secret'); }]] as const) {
    const { service, calls } = setup(cookie, undefined, verify);
    await assert.rejects(service.editorial.list(), { message: 'Unauthorized' });
    await assert.rejects(service.editorial.read('draft'), { message: 'Unauthorized' });
    assert.deepEqual(calls, []);
  }
});

test('real login connects signed sessions to isolated editorial reads and mutations', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    for (const file of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
      await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    }
    const origin = 'https://example.test';
    const password = 'synthetic password';
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const hash = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    const auth = createAuthComposition({ origin, username: 'admin', passwordHash: `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`, sessionSecret: key.toString('base64') }, client);
    const cookie = await auth.login('admin', password, origin);
    assert.ok(cookie);
    assert.match(cookie, /^__Host-admin=[A-Za-z0-9._-]+; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);
    let puts = 0;
    const deps = { db: drizzle(client), auth, cookie, origin, token: undefined, put: async () => { puts++; } };
    const service = createDatabasePrivateComposition(deps);
    const input = { slug: 'auth-seam', title: 'Title', excerpt: 'Excerpt', content: 'Text', tags: [], coverImage: null };
    const draft = await service.editorial.create(input);
    assert.deepEqual(await service.editorial.read(draft.id), draft);
    assert.deepEqual(await service.editorial.list(), [draft]);
    const edited = await service.editorial.edit(draft.id, { ...input, title: 'Updated' });
    assert.equal(edited.title, 'Updated');
    assert.deepEqual(await service.editorial.read(draft.id), edited);

    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject('admin').setIssuedAt(now - 20).setExpirationTime(now - 10).sign(key);
    const snapshot = async () => Promise.all(['posts', 'media', 'upload_intents', 'login_throttle'].map(async table => (await client.execute(`SELECT * FROM ${table} ORDER BY rowid`)).rows));
    const before = await snapshot();
    for (const [badCookie, badOrigin, readAllowed] of [[null, origin, false], [`__Host-admin=${expired}`, origin, false], [cookie, 'https://evil.test', true]] as const) {
      const denied = createDatabasePrivateComposition({ ...deps, cookie: badCookie, origin: badOrigin });
      if (readAllowed) assert.deepEqual(await denied.editorial.read(draft.id), edited);
      else {
        await assert.rejects(denied.editorial.read(draft.id), { message: 'Unauthorized' });
        await assert.rejects(denied.editorial.list(), { message: 'Unauthorized' });
      }
      await assert.rejects(denied.editorial.edit(draft.id, { ...input, title: 'Rejected' }), { message: 'Unauthorized' });
      await assert.rejects(denied.editorial.create({ ...input, slug: 'rejected' }), { message: 'Unauthorized' });
      await assert.rejects(denied.editorial.publish(draft.id), { message: 'Unauthorized' });
      await assert.rejects(denied.editorial.unpublish(draft.id), { message: 'Unauthorized' });
      assert.deepEqual(await snapshot(), before);
      assert.equal(puts, 0);
    }
  } finally { client.close(); }
});

test('private read persistence exceptions are sanitized', async () => {
  const auth = createAuthBoundary({ origin: 'https://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'x', verifySession: async () => true });
  const fail = async (): Promise<never> => { throw Error('private data'); };
  const service = createPrivateComposition({ auth, cookie: '__Host-admin=x', origin: undefined, persistence: { list: fail, read: fail, create: fail, edit: fail, publish: fail, unpublish: fail }, put: fail, register: fail, token: undefined });
  await assert.rejects(service.editorial.list(), { message: 'Editorial operation failed' });
  await assert.rejects(service.editorial.read('draft'), { message: 'Editorial operation failed' });
});
