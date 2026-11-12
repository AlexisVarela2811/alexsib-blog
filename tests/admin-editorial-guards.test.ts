// Guards for the private editor save route: authorization before any body byte,
// rotated/expired/foreign tokens, exact origin, unknown payload keys, the
// required JSON content type and the streaming byte cap. Covers S6 (session and
// origin guards, fail-closed configuration) and S2 (drafts stay private).
// Runs standalone with Node's native TypeScript runner, without spawning Next:
// it imports the route handler and session modules directly and keeps all state
// inside a temp directory that this file removes when it ends.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SignJWT } from 'jose';
import { createClient } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST } from '../src/app/api/admin/drafts/[id]/route.ts';

const origin = 'https://blog.example.test';
const salt = Buffer.alloc(16, 7);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync('synthetic test password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 31 + 3) % 256)).toString('base64');
const rotated = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 29) % 256)).toString('base64');
const rejection = 'No se pudieron guardar los cambios';
const dir = await mkdtemp(join(tmpdir(), 'blog-editor-guards-'));
const dbPath = join(dir, 'fixture.sqlite');
process.env.TURSO_DATABASE_URL = pathToFileURL(dbPath).href;
process.env.AUTH_ORIGIN = origin;
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = hash;
process.env.AUTH_SESSION_SECRET = secret;
const client = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}
const now = new Date().toISOString();
const insert = (id: string, slug: string, status: string) => client.execute({
  sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
        VALUES (?, ?, ?, 'R.', '# C', '["P"]', NULL, ?, ?, ?, ?)`,
  args: [id, slug, 'Titulo ' + id, status, now, now, status === 'published' ? now : null],
});
await insert('draft-a', 'borrador-a', 'draft');
await insert('draft-b', 'borrador-b', 'draft');
await insert('published-c', 'publicado-c', 'published');
const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const payload = (slug: string) => JSON.stringify({ title: 'Editado ' + slug, slug, excerpt: 'Resumen.', tags: 'Uno, Dos', markdown: '# Editado' });
const token = (o: { sub?: string; iat: number; exp: number; key: string }) => new SignJWT({})
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(o.sub ?? 'admin')
  .setIssuedAt(o.iat).setExpirationTime(o.exp).sign(Buffer.from(o.key, 'base64'));
const nowSeconds = Math.floor(Date.now() / 1000);
const fileHash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
function request(id: string, o: { cookie?: string | null; origin?: string | null; contentType?: string | null; body?: string | ReadableStream<Uint8Array> | null } = {}) {
  const headers = new Headers();
  if (o.contentType !== null) headers.set('content-type', o.contentType ?? 'application/json');
  if (o.cookie !== null) headers.set('cookie', o.cookie ?? cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? origin);
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST', headers,
    body: o.body === null ? undefined : o.body ?? payload('borrador-a'),
  };
  if (o.body instanceof ReadableStream) init.duplex = 'half';
  return new Request(`${origin}/api/admin/drafts/${id}`, init);
}
const save = (req: Request, id: string) => POST(req, { params: Promise.resolve({ id }) });
after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

test('S6: rotated key, expired, foreign-subject, over-lifetime and duplicate cookies are rejected without writing', async () => {
  const before = fileHash();
  for (const bad of [
    `__Host-admin=${await createAdminSessionWithConfig({ secret: rotated })}`,
    `__Host-admin=${await token({ iat: nowSeconds - 7200, exp: nowSeconds - 3600, key: secret })}`,
    `__Host-admin=${await token({ sub: 'reader', iat: nowSeconds, exp: nowSeconds + 3600, key: secret })}`,
    `__Host-admin=${await token({ iat: nowSeconds, exp: nowSeconds + 86400, key: secret })}`,
    `${cookie}; __Host-admin=forged`,
  ]) {
    const response = await save(request('draft-a', { cookie: bad }), 'draft-a');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  }
  assert.equal(fileHash(), before);
});

test('S6: missing origin, missing session and unconfigured auth fail closed', async () => {
  const before = fileHash();
  assert.equal((await save(request('draft-a', { origin: null }), 'draft-a')).status, 400);
  assert.equal((await save(request('draft-a', { cookie: null }), 'draft-a')).status, 400);
  const saved = { origin: process.env.AUTH_ORIGIN, secret: process.env.AUTH_SESSION_SECRET };
  delete process.env.AUTH_ORIGIN;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    assert.equal((await save(request('draft-a'), 'draft-a')).status, 400);
  } finally {
    process.env.AUTH_ORIGIN = saved.origin;
    process.env.AUTH_SESSION_SECRET = saved.secret;
  }
  assert.equal(fileHash(), before);
});

test('S2: an authorized session saves only the addressed draft and never a published row', async () => {
  // The charset parameter is optional but accepted, covering the content-type rule's positive side.
  const saved = await save(request('draft-b', { body: payload('borrador-b'), contentType: 'application/json; charset=utf-8' }), 'draft-b');
  assert.equal(saved.status, 200);
  const rows = await client.execute({ sql: 'SELECT id, slug, title FROM posts ORDER BY id' });
  assert.deepEqual(rows.rows.map(row => row.id), ['draft-a', 'draft-b', 'published-c']);
  assert.equal(rows.rows[0].title, 'Titulo draft-a');
  assert.equal(rows.rows[1].title, 'Editado borrador-b');
  const before = fileHash();
  assert.equal((await save(request('published-c', { body: payload('publicado-c') }), 'published-c')).status, 400);
  assert.equal(fileHash(), before);
});

test('S6: unknown payload keys are rejected without writing', async () => {
  const before = fileHash();
  for (const body of [
    JSON.stringify({ status: 'published', id: 'draft-b' }),
    JSON.stringify({ ...JSON.parse(payload('borrador-a')), status: 'published' }),
  ]) {
    const response = await save(request('draft-a', { body }), 'draft-a');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  }
  assert.equal(fileHash(), before);
});

test('S6: a non-JSON content type is rejected without writing', async () => {
  const before = fileHash();
  for (const contentType of [null, 'text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=iso-8859-1']) {
    const response = await save(request('draft-a', { contentType }), 'draft-a');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  }
  assert.equal(fileHash(), before);
});

test('S6: a stream over the byte cap is rejected and the stream is not fully consumed', async () => {
  const before = fileHash();
  const chunkSize = 64 * 1024;
  const totalChunks = 40; // 2.5 MiB, well over the 1,500,000-byte cap.
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= totalChunks) { controller.close(); return; }
      produced += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  const response = await save(request('draft-a', { body: stream }), 'draft-a');
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejection);
  assert.ok(produced < totalChunks, `expected the stream to be cancelled early, consumed ${produced}/${totalChunks} chunks`);
  assert.equal(fileHash(), before);
});

test('S6: missing, empty and over-limit bodies keep the generic rejection', async () => {
  const before = fileHash();
  for (const body of [null, '', 'x'.repeat(1_500_001)]) {
    const response = await save(request('draft-a', { body }), 'draft-a');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  }
  assert.equal(fileHash(), before);
});
