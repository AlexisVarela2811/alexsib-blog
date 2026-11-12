import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { existingObjectsQuery } from '../scripts/migration-guard.ts';

test('remote empty database guard detects sqlite-prefixed user tables', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute('CREATE TABLE sqliteXcustomer (id INTEGER)');
    assert.equal((await client.execute(existingObjectsQuery)).rows.length, 1);
  } finally { client.close(); }
});

test('remote migration requires an explicit token before connecting', () => {
  const result = spawnSync('node', ['--experimental-strip-types', 'scripts/migrate.ts', '--remote'], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test', TURSO_DATABASE_URL: 'libsql://example.invalid' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Remote migration requires TURSO_AUTH_TOKEN/);
});

test('remote migration rejects insecure URL options and unknown flags before connecting', () => {
  const env = { PATH: process.env.PATH, NODE_ENV: 'test' as const, TURSO_DATABASE_URL: 'libsql://example.invalid?tls=0', TURSO_AUTH_TOKEN: 'synthetic-token' };
  for (const args of [['--remote'], ['--unknown']]) {
    const result = spawnSync('node', ['--experimental-strip-types', 'scripts/migrate.ts', ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /synthetic-token/);
    assert.match(result.stderr, args[0] === '--remote' ? /secure libsql URL/ : /Unknown migration option/);
  }
});

test('migration rejects existing conflicting reservations without changing records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alexsib-conflict-'));
  const url = pathToFileURL(join(dir, 'test.sqlite')).href;
  const client = createClient({ url });
  try {
    for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql']) await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    await client.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('p','p','t','e','c','[]','draft','now','now')");
    await client.execute("INSERT INTO media VALUES ('m','p','private/path')");
    await client.execute("INSERT INTO upload_intents VALUES ('o','other','p','private/path','prepared')");
    const beforeMedia = (await client.execute('SELECT * FROM media')).rows;
    const beforeIntents = (await client.execute('SELECT * FROM upload_intents')).rows;
    const beforeSchema = (await client.execute("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")).rows;
    assert.equal(beforeSchema.some(row => row.name === 'login_throttle'), false);
    const hash = () => createHash('sha256').update(readFileSync(join(dir, 'test.sqlite'))).digest('hex');
    const beforeHash = hash();
    const env = { PATH: process.env.PATH, NODE_ENV: 'test' as const, TURSO_DATABASE_URL: url };
    const result = spawnSync('node', ['--experimental-strip-types', 'scripts/migrate.ts'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Conflicting upload reservations require reconciliation/);
    assert.deepEqual((await client.execute('SELECT * FROM media')).rows, beforeMedia);
    assert.deepEqual((await client.execute('SELECT * FROM upload_intents')).rows, beforeIntents);
    assert.deepEqual((await client.execute("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")).rows, beforeSchema);
    assert.equal(hash(), beforeHash);
  } finally { client.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('migration preserves previously registered matching media and unrelated reservations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alexsib-existing-'));
  const url = pathToFileURL(join(dir, 'test.sqlite')).href;
  const client = createClient({ url });
  try {
    for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql']) await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
    await client.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('p','p','t','e','c','[]','draft','now','now')");
    await client.execute("INSERT INTO media VALUES ('m','p','private/path')");
    await client.execute("INSERT INTO upload_intents VALUES ('o','m','p','private/path','registered'),('o2','m2','p','private/other','prepared')");
    const mediaBefore = (await client.execute('SELECT * FROM media')).rows;
    const intentsBefore = (await client.execute('SELECT * FROM upload_intents ORDER BY operation_id')).rows;
    const env = { PATH: process.env.PATH, NODE_ENV: 'test' as const, TURSO_DATABASE_URL: url };
    const run = () => execFileSync('node', ['--experimental-strip-types', 'scripts/migrate.ts'], { env, encoding: 'utf8', stdio: 'pipe' });
    assert.match(run(), /Migration completed/);
    assert.match(run(), /Migration completed/);
    assert.deepEqual((await client.execute('SELECT * FROM media')).rows, mediaBefore);
    assert.deepEqual((await client.execute('SELECT * FROM upload_intents ORDER BY operation_id')).rows, intentsBefore);
  } finally { client.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('local migrations are repeatable and preserve existing data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alexsib-migration-'));
  const url = pathToFileURL(join(dir, 'test.sqlite')).href;
  try {
    const env = { PATH: process.env.PATH, NODE_ENV: 'test' as const, TURSO_DATABASE_URL: url };
    const run = () => execFileSync('node', ['--experimental-strip-types', 'scripts/migrate.ts'], { env, encoding: 'utf8', stdio: 'pipe' });
    assert.match(run(), /Migration completed/);
    const client = createClient({ url });
    try {
      await client.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('p','p','t','e','c','[]','draft','now','now')");
      assert.match(run(), /Migration completed/);
      assert.equal((await client.execute('SELECT count(*) AS n FROM posts')).rows[0].n, 1);
      assert.equal((await client.execute('SELECT count(*) AS n FROM upload_intents')).rows[0].n, 0);
    } finally { client.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
