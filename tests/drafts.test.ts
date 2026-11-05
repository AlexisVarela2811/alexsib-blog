import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { posts } from '../src/db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDraft, editDraft, listDrafts, publishDraft, unpublishDraft } from '../src/lib/drafts.ts';

const input = { slug: 'hello-world', title: 'Hello', excerpt: 'An excerpt', content: 'Some content', tags: ['test'], coverImage: null };

test('draft lifecycle preserves creation metadata and public filtering', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0002_media.sql', 'utf8'));
    const db = drizzle(client);
    const created = await createDraft(db, input);
    assert.equal(created.status, 'draft');
    assert.equal((await listDrafts(db)).length, 1);
    assert.equal((await db.select().from(posts).where(eq(posts.status, 'published'))).length, 0);
    const edited = await editDraft(db, created.id, { ...input, title: 'Changed' });
    assert.equal(edited.createdAt, created.createdAt);
    assert.equal(edited.id, created.id);
    const published = await publishDraft(db, created.id);
    assert.equal(published.status, 'published');
    assert.ok(published.publishedAt);
    assert.equal((await listDrafts(db)).length, 0);
    assert.equal((await db.select().from(posts).where(eq(posts.status, 'published'))).length, 1);
    const unpublished = await unpublishDraft(db, created.id);
    assert.equal(unpublished.status, 'draft');
    assert.equal(unpublished.publishedAt, null);
    assert.equal(unpublished.createdAt, created.createdAt);
    assert.equal((await db.select().from(posts).where(eq(posts.status, 'published'))).length, 0);
    assert.equal((await publishDraft(db, created.id)).status, 'published');
  } finally { client.close(); }
});

test('legacy HTTPS covers can only be retained on drafts', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0002_media.sql', 'utf8'));
    const db = drizzle(client);
    const legacy = 'https://example.com/cover.png';
    const managed = '/media/12345678-1234-1234-1234-123456789abc';
    const draft = await createDraft(db, input);
    await db.update(posts).set({ coverImage: legacy }).where(eq(posts.id, draft.id));
    const edited = await editDraft(db, draft.id, { ...input, title: 'Edited', coverImage: legacy });
    assert.equal(edited.coverImage, legacy);
    assert.equal(edited.title, 'Edited');
    const before = await listDrafts(db);
    await assert.rejects(() => createDraft(db, { ...input, slug: 'new', coverImage: legacy }));
    await assert.rejects(() => editDraft(db, draft.id, { ...input, coverImage: 'https://example.com/new.png' }));
    await assert.rejects(() => publishDraft(db, draft.id));
    assert.deepEqual(await listDrafts(db), before);
    assert.equal((await editDraft(db, draft.id, { ...input, coverImage: managed })).coverImage, managed);
    await assert.rejects(() => editDraft(db, draft.id, { ...input, coverImage: legacy }));
    assert.equal((await editDraft(db, draft.id, input)).coverImage, null);
    assert.equal((await publishDraft(db, draft.id)).status, 'published');
  } finally { client.close(); }
});

test('invalid inputs and slug conflicts never change stored data', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0002_media.sql', 'utf8'));
    const db = drizzle(client);
    const first = await createDraft(db, input);
    const second = await createDraft(db, { ...input, slug: 'other' });
    const before = await db.select().from(posts);
    for (const invalid of [null, {}, { ...input, slug: '../bad' }, { ...input, title: '' }, { ...input, excerpt: '' }, { ...input, content: '' }, { ...input, tags: [5] }, { ...input, coverImage: 'javascript:alert(1)' }, { ...input, content: '![external](https://example.com/image.png)' }, { ...input, status: 'published' }]) {
      await assert.rejects(() => createDraft(db, invalid));
      await assert.rejects(() => editDraft(db, first.id, invalid));
    }
    await assert.rejects(() => createDraft(db, input));
    await assert.rejects(() => editDraft(db, second.id, input));
    await assert.rejects(() => editDraft(db, '', input));
    await assert.rejects(() => publishDraft(db, 'missing'));
    await assert.rejects(() => unpublishDraft(db, 'missing'));
    assert.deepEqual(await db.select().from(posts), before);
    await publishDraft(db, first.id);
    const published = await db.select().from(posts);
    await assert.rejects(() => editDraft(db, first.id, input));
    await assert.rejects(() => publishDraft(db, first.id));
    await assert.rejects(() => unpublishDraft(db, second.id));
    assert.deepEqual(await db.select().from(posts), published);
  } finally { client.close(); }
});
