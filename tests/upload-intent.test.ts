import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// @ts-expect-error Node requires explicit extensions.
import { createIntent, findIntent, transitionIntent, registerIntent } from '../src/lib/uploads/intent.ts';
// @ts-expect-error Node requires explicit extensions.
import { registerMedia } from '../src/lib/media/membership.ts';

const operationId = '00000000-0000-4000-8000-000000000001';
const mediaId = '00000000-0000-4000-8000-000000000002';
const intent = { operationId, mediaId, postId: 'draft', storagePath: 'private/image' };

async function setup() {
  const client = createClient({ url: ':memory:' });
  for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
  await client.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('draft','draft','t','e','c','[]','draft','now','now'),('published','published','t','e','c','[]','published','now','now')");
  return { client, db: drizzle(client) };
}

test('intents validate, persist idempotently and reject conflicting reuse', async () => {
  const { client, db } = await setup();
  try {
    assert.equal(await findIntent(db, operationId), null);
    for (const invalid of [{ ...intent, operationId: '' }, { ...intent, mediaId: 'bad' }, { ...intent, postId: '' }, { ...intent, storagePath: '' }]) await assert.rejects(() => createIntent(db, invalid));
    assert.equal((await createIntent(db, intent)).state, 'prepared');
    assert.deepEqual(await createIntent(db, intent), await findIntent(db, operationId));
    await assert.rejects(() => createIntent(db, { ...intent, storagePath: 'different' }));
    await assert.rejects(() => createIntent(db, { ...intent, operationId: mediaId }));
    assert.equal((await findIntent(db, operationId))?.storagePath, intent.storagePath);
    assert.equal((await client.execute('SELECT count(*) AS n FROM upload_intents')).rows[0].n, 1);
  } finally { client.close(); }
});

test('conditional transitions reject stale or invalid states and registration is atomic and idempotent', async () => {
  const { client, db } = await setup();
  try {
    await createIntent(db, intent);
    await assert.rejects(() => transitionIntent(db, operationId, 'prepared', 'registered'));
    assert.equal((await transitionIntent(db, operationId, 'prepared', 'uploaded')).state, 'uploaded');
    await assert.rejects(() => transitionIntent(db, operationId, 'prepared', 'uploaded'));
    assert.equal((await registerIntent(db, operationId)).state, 'registered');
    assert.equal((await registerIntent(db, operationId)).state, 'registered');
    await assert.rejects(() => transitionIntent(db, operationId, 'uploaded', 'prepared'));
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 1);
    assert.equal((await findIntent(db, operationId))?.state, 'registered');
  } finally { client.close(); }
});

test('registration rejects non-drafts without changing media or intent', async () => {
  const { client, db } = await setup();
  try {
    await createIntent(db, intent);
    await transitionIntent(db, operationId, 'prepared', 'uploaded');
    await client.execute("UPDATE posts SET status = 'published' WHERE id = 'draft'");
    await assert.rejects(() => registerIntent(db, operationId));
    assert.equal((await findIntent(db, operationId))?.state, 'uploaded');
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 0);
  } finally { client.close(); }
});

test('media paths and identifiers cannot be reserved twice in either direction', async () => {
  const { client, db } = await setup();
  try {
    await registerMedia(db, 'draft', mediaId, intent.storagePath);
    await assert.rejects(() => createIntent(db, intent));
    assert.equal(await findIntent(db, operationId), null);
    const other = { ...intent, mediaId: '00000000-0000-4000-8000-000000000003', storagePath: 'private/other' };
    await createIntent(db, other);
    await assert.rejects(() => registerMedia(db, 'draft', '00000000-0000-4000-8000-000000000004', other.storagePath));
    await assert.rejects(() => registerMedia(db, 'draft', other.mediaId, 'private/different'));
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 1);
    assert.equal((await findIntent(db, operationId))?.state, 'prepared');
    await transitionIntent(db, operationId, 'prepared', 'uploaded');
    assert.equal((await registerIntent(db, operationId)).state, 'registered');
  } finally { client.close(); }
});

test('existing intent blocks conflicting media registration independently', async () => {
  const { client, db } = await setup();
  try {
    await createIntent(db, intent);
    await assert.rejects(() => registerMedia(db, 'draft', '00000000-0000-4000-8000-000000000004', intent.storagePath));
    await assert.rejects(() => registerMedia(db, 'draft', mediaId, 'private/other'));
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 0);
    assert.equal((await findIntent(db, operationId))?.state, 'prepared');
  } finally { client.close(); }
});

test('two local clients cannot both claim the same path concurrently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alexsib-race-'));
  const url = pathToFileURL(join(dir, 'db.sqlite')).href;
  const first = createClient({ url });
  const second = createClient({ url });
  try {
    for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) await first.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    await first.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('draft','draft','t','e','c','[]','draft','now','now')");
    const results = await Promise.allSettled([createIntent(drizzle(first), intent), registerMedia(drizzle(second), 'draft', '00000000-0000-4000-8000-000000000004', intent.storagePath)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const a = Number((await first.execute('SELECT count(*) AS n FROM media')).rows[0].n);
    const b = Number((await first.execute('SELECT count(*) AS n FROM upload_intents')).rows[0].n);
    assert.equal(a + b, 1);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('failed registration rolls back insertion and preserves intent', async () => {
  const { client, db } = await setup();
  try {
    await createIntent(db, intent);
    await transitionIntent(db, operationId, 'prepared', 'uploaded');
    await client.execute("CREATE TRIGGER fail_media_insert BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await assert.rejects(() => registerIntent(db, operationId), (error: unknown) => error instanceof Error && error.cause instanceof Error && /injected failure/.test(error.cause.message));
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 0);
    assert.equal((await findIntent(db, operationId))?.state, 'uploaded');
  } finally { client.close(); }
});

test('existing registration retains draft-only validation and uniqueness', async () => {
  const { client, db } = await setup();
  try {
    await assert.rejects(() => registerMedia(db, 'published', mediaId, 'private/image'));
    await assert.rejects(() => registerMedia(db, 'draft', 'bad', 'private/image'));
    assert.equal((await registerMedia(db, 'draft', mediaId, 'private/image')).id, mediaId);
    await assert.rejects(() => registerMedia(db, 'draft', mediaId, 'private/image'));
    assert.equal((await client.execute('SELECT count(*) AS n FROM media')).rows[0].n, 1);
  } finally { client.close(); }
});
