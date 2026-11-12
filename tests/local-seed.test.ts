import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const slug = 'que-es-una-ventana-de-contexto';
const root = join(process.cwd(), 'test-results');

test('local seed is explicit, repeatable, and preserves existing records', async () => {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'local-seed-'));
  const url = pathToFileURL(join(dir, 'test.sqlite')).href;
  const env = { PATH: process.env.PATH, NODE_ENV: 'test' as const, TURSO_DATABASE_URL: url };
  const run = (target?: string) => spawnSync('npm', ['run', '--silent', 'db:seed'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', ...(target === undefined ? {} : { TURSO_DATABASE_URL: target }) },
  });
  const client = createClient({ url });
  try {
    const migration = spawnSync('npm', ['run', '--silent', 'db:migrate'], { encoding: 'utf8', env });
    assert.equal(migration.status, 0, migration.stderr);
    await client.execute({ sql: 'INSERT INTO posts (id, slug, title, excerpt, content, tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: ['other', 'otro', 'Otro', 'Resumen', 'Contenido', '[]', 'draft', '2025', '2025'] });
    const before = await client.execute('SELECT * FROM posts ORDER BY id');
    for (const target of [undefined, 'libsql://example.invalid/db', 'https://example.invalid/db', 'file://remote.example/db']) {
      const result = run(target);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Seed requires an explicit local file: TURSO_DATABASE_URL\n');
      assert.deepEqual((await client.execute('SELECT * FROM posts ORDER BY id')).rows, before.rows);
    }
    const first = run(url);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, 'Example article created\n');
    assert.equal(first.stderr, '');
    const published = await client.execute({ sql: "SELECT * FROM posts WHERE status = 'published' AND slug = ?", args: [slug] });
    assert.equal(published.rows.length, 1);
    assert.match(String(published.rows[0].content), /```context-window\n```/);
    const after = await client.execute('SELECT * FROM posts ORDER BY id');
    assert.deepEqual(after.rows.find(row => row.id === 'other'), before.rows[0]);
    const again = run(url);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, 'Example article already exists; no changes made\n');
    assert.equal(again.stderr, '');
    assert.deepEqual((await client.execute('SELECT * FROM posts ORDER BY id')).rows, after.rows);
    await client.execute({ sql: 'UPDATE posts SET title = ?, status = ? WHERE slug = ?', args: ['Existing article', 'draft', slug] });
    const conflict = await client.execute('SELECT * FROM posts ORDER BY id');
    const skipped = run(url);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(skipped.stdout, 'Example article already exists; no changes made\n');
    assert.equal(skipped.stderr, '');
    assert.deepEqual((await client.execute('SELECT * FROM posts ORDER BY id')).rows, conflict.rows);
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
