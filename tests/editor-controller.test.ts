import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { posts } from '../src/db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialPersistence } from '../src/lib/editorial/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorController } from '../src/lib/editorial/editor-controller.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialService } from '../src/lib/editorial/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDatabasePrivateComposition } from '../src/lib/editorial/private-composition.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAuthBoundary } from '../src/lib/auth/boundary.ts';

const values = { title: 'Title', slug: 'title', excerpt: 'Excerpt', tags: ' IA, , Web, IA ', markdown: '# Hello' };
const article = { id: 'one', title: 'Old', slug: 'old', excerpt: 'Old excerpt', tags: ['IA', 'Web'], content: '# Old', coverImage: 'https://example.com/legacy.png', status: 'draft' as const, createdAt: 'now', updatedAt: 'now', publishedAt: null };

function setup(readAllowed = true, writeAllowed = true) {
  const calls: unknown[][] = [];
  const service = createEditorialService({
    authorizeRead: async () => readAllowed,
    authorizeMutation: async () => writeAllowed,
    persistence: {
      list: async () => [],
      read: async id => { calls.push(['read', id]); return article; },
      create: async input => { calls.push(['create', input]); return article; },
      edit: async (id, input) => { calls.push(['edit', id, input]); return article; },
      publish: async () => article,
      unpublish: async () => article,
    },
  });
  return { controller: createEditorController(service), calls };
}

test('load maps only editor values and create maps tags and markdown', async () => {
  const { controller, calls } = setup();
  assert.deepEqual(await controller.load('one'), { title: 'Old', slug: 'old', excerpt: 'Old excerpt', tags: 'IA, Web', markdown: '# Old' });
  await controller.create(values);
  assert.deepEqual(calls, [['read', 'one'], ['create', { title: 'Title', slug: 'title', excerpt: 'Excerpt', tags: ['IA', 'Web', 'IA'], content: '# Hello', coverImage: null }]]);
});

test('edit reads and preserves the current legacy cover', async () => {
  const { controller, calls } = setup();
  await controller.edit('one', values);
  assert.deepEqual(calls, [['read', 'one'], ['edit', 'one', { title: 'Title', slug: 'title', excerpt: 'Excerpt', tags: ['IA', 'Web', 'IA'], content: '# Hello', coverImage: article.coverImage }]]);
});

test('denied reads and writes fail closed without persistence mutation', async () => {
  const deniedRead = setup(false, true);
  await assert.rejects(() => deniedRead.controller.load('one'), { message: 'Editorial operation failed' });
  await assert.rejects(() => deniedRead.controller.edit('one', values), { message: 'Editorial operation failed' });
  assert.deepEqual(deniedRead.calls, []);
  const deniedWrite = setup(true, false);
  await assert.rejects(() => deniedWrite.controller.create(values), { message: 'Editorial operation failed' });
  await assert.rejects(() => deniedWrite.controller.edit('one', values), { message: 'Editorial operation failed' });
  assert.deepEqual(deniedWrite.calls, [['read', 'one']]);
});

test('concurrent cover change rejects stale editor edit without changing the new row', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    const db = drizzle(client);
    const persistence = createEditorialPersistence(db);
    const service = createEditorialService({ authorizeRead: async () => true, authorizeMutation: async () => true, persistence });
    const created = await service.create({ slug: 'old', title: 'Old', excerpt: 'Excerpt', content: 'Content', tags: [], coverImage: null });
    const managed = '/media/12345678-1234-1234-1234-123456789abc';
    for (const cover of [null, 'https://example.com/legacy.png', '/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']) {
      await db.update(posts).set({ coverImage: cover }).where(eq(posts.id, created.id));
      let afterConcurrent: Awaited<ReturnType<typeof service.read>>;
      const controller = createEditorController({ ...service, read: async id => {
        const stale = await service.read(id);
        afterConcurrent = await service.edit(id, { slug: 'old', title: 'Concurrent', excerpt: 'Excerpt', content: 'Content', tags: [], coverImage: managed });
        return stale;
      } });
      await assert.rejects(() => controller.edit(created.id, values), { message: 'Editorial operation failed' });
      assert.deepEqual(await service.read(created.id), afterConcurrent);
    }
  } finally { client.close(); }
});

test('controller connects to database composition and enforces the auth boundary', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
      await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    }
    const db = drizzle(client);
    const auth = createAuthBoundary({ origin: 'https://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'token', verifySession: async token => token === 'token' });
    const deps = { db, auth, cookie: '__Host-admin=token', origin: 'https://example.test', token: undefined, put: async () => { throw Error('unexpected upload'); } };
    const service = createDatabasePrivateComposition(deps).editorial;
    const controller = createEditorController(service);
    await controller.create(values);
    const [created] = await service.list();
    assert.ok(created);
    assert.deepEqual(await controller.load(created.id), { ...values, tags: 'IA, Web, IA' });
    const cover = 'https://example.com/legacy.png';
    await db.update(posts).set({ coverImage: cover }).where(eq(posts.id, created.id));
    const edited = { title: 'Edited', slug: 'edited', excerpt: 'Changed', tags: 'One, Two', markdown: '# Edited' };
    await controller.edit(created.id, edited);
    assert.deepEqual(await controller.load(created.id), edited);
    assert.equal((await service.read(created.id))?.coverImage, cover);

    const snapshot = async () => (await client.execute('SELECT * FROM posts ORDER BY id')).rows;
    const before = await snapshot();
    for (const overrides of [
      { cookie: '__Host-admin=invalid', origin: 'https://example.test' },
      { cookie: '__Host-admin=token', origin: 'https://evil.test' },
    ]) {
      const denied = createEditorController(createDatabasePrivateComposition({ ...deps, ...overrides }).editorial);
      if (overrides.cookie.includes('invalid')) {
        await assert.rejects(() => denied.load(created.id), { message: 'Editorial operation failed' });
      } else {
        assert.deepEqual(await denied.load(created.id), edited);
      }
      await assert.rejects(() => denied.create(values), { message: 'Editorial operation failed' });
      await assert.rejects(() => denied.edit(created.id, values), { message: 'Editorial operation failed' });
      assert.deepEqual(await snapshot(), before);
    }
  } finally { client.close(); }
});

test('missing articles and service errors do not expose details', async () => {
  const fail = async () => { throw new Error('private details'); };
  const controller = createEditorController({ read: async () => undefined, create: fail, edit: fail });
  await assert.rejects(() => controller.load('missing'), { message: 'Editorial operation failed' });
  await assert.rejects(() => controller.edit('missing', values), { message: 'Editorial operation failed' });
  await assert.rejects(() => controller.create(values), { message: 'Editorial operation failed' });
});
