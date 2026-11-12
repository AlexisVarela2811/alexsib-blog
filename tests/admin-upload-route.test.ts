// Guarded image upload for one private draft (S2 draft image privacy,
// S6 session guard). The route accepts one raw image body per draft, needs
// the `__Host-admin` session cookie AND the exact configured Origin before
// reading any body byte, enforces the same streaming byte cap as the upload
// limit, and answers one generic rejection with no-store for every failure —
// including provider and reconciliation failures. Success is a documented
// JSON answer with the /media/<id> path (the editor already saves with fetch;
// a plain form reload would discard unsaved edits), so the exact success
// mapping is exercised through the authorized session function with a fake
// private Blob store instead of the real provider.
// Runs standalone with Node's native TypeScript runner: it imports the route
// handler and session module directly, uses synthetic configuration, a
// temporary SQLite database that this file removes when it ends, and a fake
// Blob store. No network, no real credentials, no Next server.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { uploadDraftImage } from '../src/app/admin/editorial-session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as uploadRoute } from '../src/app/api/admin/drafts/[id]/upload/route.ts';

const origin = 'https://blog.example.test';
const rejection = 'No se pudo subir la imagen';
const salt = Buffer.alloc(16, 7);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync('synthetic test password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256)).toString('base64');
const token = 'synthetic-blob-token';

const dir = await mkdtemp(join(tmpdir(), 'blog-admin-upload-'));
const dbPath = join(dir, 'fixture.sqlite');
process.env.TURSO_DATABASE_URL = pathToFileURL(dbPath).href;
process.env.AUTH_ORIGIN = origin;
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = hash;
process.env.AUTH_SESSION_SECRET = secret;
process.env.BLOB_READ_WRITE_TOKEN = token;
const client: Client = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}

const now = new Date().toISOString();
const insertPost = (id: string, slug: string, status: 'draft' | 'published') => client.execute({
  sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
        VALUES (?, ?, 'Titulo', 'Resumen.', '# Cuerpo', '["Pruebas"]', NULL, ?, ?, ?, ?)`,
  args: [id, slug, status, now, now, status === 'published' ? now : null],
});
await insertPost('up-target', 'subir-objetivo', 'draft');
await insertPost('up-published', 'ya-publicado', 'published');

const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const fileHash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');

// Valid image payloads: only the container signature is checked by design.
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const garbage = Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 31 + 7) % 256));

// Fake private Blob store: records puts and deletions, never touches a network.
type PutCall = { pathname: string; body: Buffer; options: { access: string; contentType: string; token: string; allowOverwrite: boolean } };
const putCalls: PutCall[] = [];
const deletions: string[] = [];
const fakePut = async (pathname: string, body: Buffer, options: PutCall['options']) => {
  putCalls.push({ pathname, body, options });
  return { pathname, url: `https://fake-blob.test/${pathname}` };
};
const throwingPut = async (pathname: string, body: Buffer, options: PutCall['options']) => {
  putCalls.push({ pathname, body, options });
  throw new Error('put failed after the provider may have stored the object: synthetic-bucket, synthetic-token');
};
const resetProvider = () => { putCalls.length = 0; deletions.length = 0; };

const streamOf = (bytes: Uint8Array): AsyncIterable<Uint8Array> => (async function* () { yield bytes; })();

const mediaRows = async (postId: string) => (await client.execute({
  sql: 'SELECT id, storage_path FROM media WHERE post_id = ?', args: [postId],
})).rows;
const intentRows = async (postId: string) => (await client.execute({
  sql: 'SELECT operation_id, media_id, storage_path, state FROM upload_intents WHERE post_id = ?', args: [postId],
})).rows;

type ReqOpts = { cookie?: string | null; origin?: string | null; type?: string | null; body?: BodyInit | null };
function uploadRequest(o: ReqOpts = {}) {
  const headers = new Headers();
  if (o.cookie !== null) headers.set('cookie', o.cookie ?? cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? origin);
  if (o.type !== null) headers.set('content-type', o.type ?? 'image/png');
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST', headers,
    // null means no body at all; a streaming body needs duplex half in undici.
    body: o.body === null ? undefined : o.body ?? png,
  };
  if (o.body instanceof ReadableStream) init.duplex = 'half';
  return new Request(`${origin}/api/admin/drafts/up-target/upload`, init as RequestInit);
}
const route = (o?: ReqOpts) => uploadRoute(uploadRequest(o), { params: Promise.resolve({ id: 'up-target' }) });

after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

test('S6: uploading without a session, exact origin or usable auth configuration fails generically without reading storage', async () => {
  const before = fileHash();
  for (const bad of [
    route({ cookie: null }),
    route({ cookie: '__Host-admin=forged' }),
    route({ origin: 'https://evil.example' }),
    route({ origin: null }),
    route({ body: null }),
  ]) {
    const response = await bad;
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const saved = process.env.AUTH_SESSION_SECRET;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    const response = await route();
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  } finally { process.env.AUTH_SESSION_SECRET = saved; }
  assert.equal(fileHash(), before);
  assert.deepEqual(await mediaRows('up-target'), []);
  assert.deepEqual(await intentRows('up-target'), []);
  assert.equal(putCalls.length, 0);
});

test('S6: only an accepted image content type is uploaded; every other body is the generic rejection', async () => {
  const before = fileHash();
  for (const type of [null, 'text/plain', 'multipart/form-data', 'application/json', 'image/gif', 'image/png; charset=utf-8']) {
    const response = await route({ type });
    assert.equal(response.status, 400, `content type ${String(type)} must be rejected`);
    assert.equal(await response.text(), rejection);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(fileHash(), before);
  assert.deepEqual(await intentRows('up-target'), []);
  assert.equal(putCalls.length, 0);
});

test('S2: a body larger than the upload limit is rejected with its stream cancelled and nothing buffered or stored', async () => {
  const before = fileHash();
  let cancelled = false;
  let pulls = 0;
  const oversized = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  const response = await route({ body: oversized });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejection);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(cancelled, true, 'the oversized stream must be cancelled, not fully consumed');
  assert.ok(pulls <= 7, `expected few reads under the 5 MiB cap, got ${pulls}`);
  assert.equal(fileHash(), before);
  assert.deepEqual(await intentRows('up-target'), []);
  assert.equal(putCalls.length, 0);
});

test('S2: the file signature is validated before anything reaches storage; garbage bytes are rejected untouched', async () => {
  const before = fileHash();
  const response = await route({ body: garbage });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejection);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(fileHash(), before);
  assert.deepEqual(await intentRows('up-target'), []);
  assert.deepEqual(await mediaRows('up-target'), []);
  assert.equal(putCalls.length, 0);
});

test('S6: a missing Blob token or unusable database fails closed with the generic rejection and no storage call', async () => {
  const before = fileHash();
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const response = await route();
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { process.env.BLOB_READ_WRITE_TOKEN = savedToken; }
  assert.equal(putCalls.length, 0);
  assert.equal(fileHash(), before);

  const savedUrl = process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_DATABASE_URL;
  try {
    const response = await route();
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection);
  } finally { process.env.TURSO_DATABASE_URL = savedUrl; }
  assert.equal(putCalls.length, 0);
  assert.equal(fileHash(), before);
});

test('S2: an authorized upload stores one private image owned by that draft and returns its /media/<id> path source', async () => {
  resetProvider();
  const rowsBefore = await mediaRows('up-target');
  const intentsBefore = await intentRows('up-target');
  const mediaId = await uploadDraftImage(cookie, origin, 'up-target', 'image/png', streamOf(png), fakePut);
  assert.ok(typeof mediaId === 'string' && /^[0-9a-f-]{36}$/.test(mediaId), 'success returns the new media id');
  const rows = await mediaRows('up-target');
  assert.equal(rows.length, rowsBefore.length + 1);
  assert.ok(rows.some(row => row.id === mediaId), 'the returned id is the media row of this draft');
  assert.match(String(rows[0].storage_path), /^images\/[0-9a-f]{32}\.png$/);
  const intents = await intentRows('up-target');
  assert.equal(intents.length, intentsBefore.length + 1);
  const created = intents.find(row => row.media_id === mediaId);
  assert.ok(created);
  assert.equal(created.state, 'registered');
  assert.equal(created.media_id, mediaId);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].options.access, 'private');
  assert.equal(putCalls[0].options.allowOverwrite, false);
  assert.equal(putCalls[0].options.contentType, 'image/png');
  assert.equal(putCalls[0].options.token, token);
  assert.equal(Buffer.from(png).compare(putCalls[0].body), 0);
  assert.equal(deletions.length, 0);
});

test('S2: a failed or ambiguous provider outcome leaves the durable intent for reconciliation and deletes nothing', async () => {
  resetProvider();
  const intentsBefore = await intentRows('up-target');
  const outcome = await uploadDraftImage(cookie, origin, 'up-target', 'image/png', streamOf(png), throwingPut);
  assert.equal(outcome, null, 'provider failure is a generic rejection');
  assert.equal(putCalls.length, 1, 'the provider was reached exactly once');
  // Nothing is deleted: the contract reconciles instead of destroying objects
  // it cannot prove it created.
  assert.equal(deletions.length, 0);
  const rows = await mediaRows('up-target');
  assert.ok(rows.length >= 1, 'no media row from the earlier success was touched and none was added');
  const intents = await intentRows('up-target');
  const prepared = intents.filter(row => row.state === 'prepared');
  assert.equal(prepared.length, intentsBefore.filter(row => row.state === 'prepared').length + 1,
    'the ambiguous upload keeps exactly one new prepared intent for reconciliation');
  assert.ok(prepared.every(row => !rows.some(media => media.id === row.media_id)),
    'no prepared intent refers to a registered media row');
});

test('S6: an upload without the exact origin stores nothing and reaches no provider', async () => {
  resetProvider();
  const rowsBefore = await mediaRows('up-target');
  const intentsBefore = await intentRows('up-target');
  for (const badOrigin of ['https://evil.example', undefined]) {
    const outcome = await uploadDraftImage(cookie, badOrigin, 'up-target', 'image/png', streamOf(png), fakePut);
    assert.equal(outcome, null);
  }
  assert.equal(putCalls.length, 0);
  assert.deepEqual(await mediaRows('up-target'), rowsBefore);
  assert.deepEqual(await intentRows('up-target'), intentsBefore);
  assert.equal(deletions.length, 0);
});

test('S2: uploads only attach to an existing draft; published targets and unknown ids are rejected untouched', async () => {
  resetProvider();
  for (const target of ['up-published', 'missing-draft', '../escape', '']) {
    const outcome = await uploadDraftImage(cookie, origin, target, 'image/png', streamOf(png), fakePut);
    assert.equal(outcome, null, `target ${target} must be rejected`);
  }
  assert.equal(putCalls.length, 0);
  assert.equal(deletions.length, 0);
  const rows = await mediaRows('up-published');
  assert.deepEqual(rows, []);
});

test('S6: a missing Blob token fails closed at the session layer before the provider is contacted', async () => {
  resetProvider();
  const intentsBefore = await intentRows('up-target');
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const outcome = await uploadDraftImage(cookie, origin, 'up-target', 'image/png', streamOf(png), fakePut);
    assert.equal(outcome, null);
  } finally { process.env.BLOB_READ_WRITE_TOKEN = savedToken; }
  assert.equal(putCalls.length, 0);
  assert.deepEqual(await intentRows('up-target'), intentsBefore, 'no new intent is left behind by a fail-closed configuration');
});

test('S2: the accepted image types are exactly jpeg, png and webp signatures', async () => {
  resetProvider();
  const rowsBefore = await mediaRows('up-target');
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const results: Array<string | null> = [];
  for (const [mime, bytes] of [['image/webp', webp], ['image/jpeg', jpeg]] as const) {
    const outcome = await uploadDraftImage(cookie, origin, 'up-target', mime, streamOf(bytes), fakePut);
    results.push(outcome);
  }
  for (const mediaId of results) {
    assert.ok(typeof mediaId === 'string' && /^[0-9a-f-]{36}$/.test(mediaId), 'each valid signature uploads');
  }
  assert.equal(putCalls.length, 2);
  assert.ok(putCalls.every(call => call.options.access === 'private' && call.options.allowOverwrite === false));
  const rows = await mediaRows('up-target');
  assert.equal(rows.length, rowsBefore.length + 2, 'two new uploads, all owned by the same draft');
});

test('S2: a content-type spoof (declared png, garbage signature) never reaches storage', async () => {
  resetProvider();
  const outcome = await uploadDraftImage(cookie, origin, 'up-target', 'image/png', streamOf(garbage), fakePut);
  assert.equal(outcome, null);
  assert.equal(putCalls.length, 0);
  assert.equal(deletions.length, 0);
});
