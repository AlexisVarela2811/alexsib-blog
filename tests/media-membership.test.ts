import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDraft, editDraft, publishDraft, unpublishDraft } from '../src/lib/drafts.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { registerMedia, findPublicMedia } from '../src/lib/media/membership.ts';

const input = { slug: 'first', title: 'Title', excerpt: 'Excerpt', content: 'Text', tags: [], coverImage: null };
const image = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

test('publication grants only owned references and unpublishing revokes them', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.executeMultiple(readFileSync('drizzle/0000_initial.sql', 'utf8'));
    await client.executeMultiple(readFileSync('drizzle/0002_media.sql', 'utf8'));
    const db = drizzle(client);
    const draft = await createDraft(db, input);
    const second = await createDraft(db, { ...input, slug: 'second' });
    await registerMedia(db, draft.id, image, 'private/one');
    await registerMedia(db, second.id, other, 'private/two');
    await editDraft(db, draft.id, { ...input, content: `![one](/media/${image})` });
    assert.equal(await findPublicMedia(db, image), null);
    await publishDraft(db, draft.id);
    assert.equal((await findPublicMedia(db, image))?.storagePath, 'private/one');
    assert.equal(await findPublicMedia(db, other), null);
    await unpublishDraft(db, draft.id);
    assert.equal(await findPublicMedia(db, image), null);
    await editDraft(db, draft.id, { ...input, coverImage: `/media/${other}` });
    const before = await client.execute('SELECT * FROM posts ORDER BY id');
    const membershipBefore = await client.execute('SELECT * FROM published_media');
    await assert.rejects(() => publishDraft(db, draft.id), /Media not owned by draft/);
    assert.deepEqual((await client.execute('SELECT * FROM posts ORDER BY id')).rows, before.rows);
    assert.deepEqual((await client.execute('SELECT * FROM published_media')).rows, membershipBefore.rows);
    assert.equal(await findPublicMedia(db, other), null);
    await editDraft(db, draft.id, { ...input, coverImage: `/media/${image}` });
    await publishDraft(db, draft.id);
    assert.equal((await findPublicMedia(db, image))?.storagePath, 'private/one');
  } finally { client.close(); }
});
