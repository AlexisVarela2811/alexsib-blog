import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { consumeLoginAttempt } from '../src/lib/auth/throttle.ts';

async function database() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8'));
  return client;
}

test('concurrent attempts share a durable bounded global budget', async () => {
  const client = await database();
  try {
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeLoginAttempt(client)));
    assert.equal(results.filter(Boolean).length, 5);
    assert.equal(await consumeLoginAttempt(client), false);
    await client.executeMultiple(await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8'));
    assert.equal(await consumeLoginAttempt(client), false);
  } finally { client.close(); }
});

test('missing schema and unavailable database fail closed', async () => {
  const client = createClient({ url: 'file::memory:' });
  assert.equal(await consumeLoginAttempt(client), false);
  client.close();
  assert.equal(await consumeLoginAttempt(client), false);
});

test('migration preserves existing articles and is repeatable', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    await client.executeMultiple(await readFile(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
    await client.execute("INSERT INTO posts (id, slug, title, excerpt, content, tags, status, created_at, updated_at) VALUES ('1','slug','title','excerpt','content','[]','draft','date','date')");
    const migration = await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8');
    await client.executeMultiple(migration);
    await client.executeMultiple(migration);
    const posts = await client.execute('SELECT id, title FROM posts');
    assert.deepEqual(posts.rows.map(row => [row.id, row.title]), [['1', 'title']]);
    assert.equal(await consumeLoginAttempt(client), true);
  } finally { client.close(); }
});
