// Delivery rules for GET /media/<id> (S2 draft privacy, S6 session guard):
// published membership serves bytes without authentication, draft-owned media
// needs a valid `__Host-admin` session, every other outcome is the same empty
// 404, ids are bounded before storage is touched, only accepted image content
// types are emitted and responses are streamed with explicit cache policy.
// Runs standalone with Node's native TypeScript runner: it imports the delivery
// module directly with a fake Blob store and a temporary SQLite database that
// this file removes when it ends. No network, no real credentials, no Next server.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { serveMedia } from '../src/app/media/delivery.ts';

const origin = 'https://blog.example.test';
const salt = Buffer.alloc(16, 5);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync('synthetic test password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 11) % 256)).toString('base64');
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const dir = await mkdtemp(join(tmpdir(), 'blog-media-delivery-'));
const dbPath = join(dir, 'fixture.sqlite');
const dbUrl = pathToFileURL(dbPath).href;
const client = createClient({ url: dbUrl });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}
const now = new Date().toISOString();
const insertPost = (id: string, slug: string, status: string) => client.execute({
  sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
        VALUES (?, ?, ?, 'R.', '# C', '["P"]', NULL, ?, ?, ?, ?)`,
  args: [id, slug, 'Titulo ' + id, status, now, now, status === 'published' ? now : null],
});
await insertPost('draft-a', 'borrador-a', 'draft');
await insertPost('published-c', 'publicado-c', 'published');
const insertMedia = (id: string, postId: string) => client.execute({
  sql: 'INSERT INTO media (id, post_id, storage_path) VALUES (?, ?, ?)',
  args: [id, postId, `images/${id}.png`],
});
await insertMedia('11111111-2222-4333-8444-555555555555', 'published-c'); // public: membership row below
await insertMedia('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'draft-a'); // private draft media
await insertMedia('99999999-8888-4777-8666-555555555555', 'published-c'); // published post WITHOUT membership
await client.execute({ sql: 'INSERT INTO published_media (post_id, media_id) VALUES (?, ?)', args: ['published-c', '11111111-2222-4333-8444-555555555555'] });
const publicId = '11111111-2222-4333-8444-555555555555';
const draftId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const orphanId = '99999999-8888-4777-8666-555555555555';
const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;

type FakeFile = { chunks: Uint8Array[]; contentType: string };
type BlobGetCall = { pathname: string; options: { access: string; token: string } };

/** Fake private Blob store: records calls, cancels and never touches a network. */
function fakeStore(files: Map<string, FakeFile>, calls: BlobGetCall[], cancelled: string[]) {
  return async (pathname: string, options: { access: string; token: string }) => {
    calls.push({ pathname, options });
    const file = files.get(pathname);
    if (!file) return null;
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= file.chunks.length) { controller.close(); return; }
        controller.enqueue(file.chunks[index]);
        index += 1;
      },
      cancel() { cancelled.push(pathname); },
    });
    return { statusCode: 200 as const, stream, blob: { contentType: file.contentType } };
  };
}

const allFiles = new Map<string, FakeFile>([
  [`images/${publicId}.png`, { chunks: [png], contentType: 'image/png' }],
  [`images/${draftId}.png`, { chunks: [jpeg], contentType: 'image/jpeg' }],
]);

function deps(overrides: Record<string, unknown> = {}, files = allFiles) {
  const calls: BlobGetCall[] = [];
  const cancelled: string[] = [];
  const blobGet = fakeStore(files, calls, cancelled);
  return {
    calls, cancelled, blobGet,
    base: {
      databaseUrl: dbUrl,
      token: 'fake-blob-token',
      origin, username: 'admin', passwordHash: hash, sessionSecret: secret,
      blobGet,
      ...overrides,
    },
  };
}

async function bodyBytes(response: Response): Promise<Uint8Array> {
  assert.ok(response.body, 'expected a streaming body');
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

test('S2: a published image is served without authentication, with its stored type, nosniff and shared-cacheable headers', async () => {
  const setup = deps();
  const response = await serveMedia(setup.base, publicId, null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control') ?? '', /public/);
  assert.deepEqual(await bodyBytes(response), png);
  assert.deepEqual(setup.calls, [{ pathname: `images/${publicId}.png`, options: { access: 'private', token: 'fake-blob-token' } }]);
  assert.deepEqual(setup.cancelled, []);
});

test('S2: a draft image needs a valid __Host-admin session and is never stored by shared caches', async () => {
  const anonymous = deps();
  const denied = await serveMedia(anonymous.base, draftId, null);
  assert.equal(denied.status, 404);
  assert.equal(await denied.text(), '');
  assert.deepEqual(anonymous.calls, [], 'storage must not be touched for an unauthorized draft request');
  const valid = deps();
  const response = await serveMedia(valid.base, draftId, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const cacheControl = response.headers.get('cache-control') ?? '';
  assert.match(cacheControl, /no-store/);
  assert.ok(!/public/.test(cacheControl), 'a draft image must not be cached by shared caches');
  assert.deepEqual(await bodyBytes(response), jpeg);
  assert.deepEqual(valid.calls.map(call => call.pathname), [`images/${draftId}.png`]);
});

test('S2: forged, malformed and foreign session cookies get the same empty 404', async () => {
  for (const bad of [
    '__Host-admin=forged.token.value',
    '__Host-admin=',
    'other=cookie',
    `${cookie}; __Host-admin=second`,
    'x'.repeat(9000),
  ]) {
    const setup = deps();
    const response = await serveMedia(setup.base, draftId, bad);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.deepEqual(setup.calls, []);
  }
});

test('S2: media of a published post is reachable only through published membership, never through a session', async () => {
  const withSession = deps();
  const response = await serveMedia(withSession.base, orphanId, cookie);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
  assert.deepEqual(withSession.calls, []);
});

test('S2: unknown, malformed and over-length ids are 404 without touching the provider', async () => {
  const cases = [
    '00000000-0000-4000-8000-00000000000', // 35 chars
    '00000000-0000-4000-8000-0000000000000', // 37 chars, over the length bound
    '00000000-0000-4000-8000-000000000000', // well-formed shape, unknown row
    'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', // uppercase
    '../../../etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeg', // non-hex
    '',
  ];
  for (const id of cases) {
    const setup = deps();
    const response = await serveMedia(setup.base, id, cookie);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.deepEqual(setup.calls, [], `storage must not be touched for id ${JSON.stringify(id)}`);
  }
});

test('S6: missing or invalid authentication configuration fails closed for drafts', async () => {
  for (const overrides of [{ sessionSecret: undefined }, { sessionSecret: 'not-canonical-base64' }, { origin: undefined }, { origin: 'http://blog.example.test' }]) {
    const setup = deps(overrides);
    const response = await serveMedia(setup.base, draftId, cookie);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.deepEqual(setup.calls, []);
  }
});

test('S2: only image content types accepted by the upload validation are emitted; others are 404 and the stream is cancelled', async () => {
  for (const contentType of ['image/gif', 'text/html', 'image/svg+xml', 'application/octet-stream']) {
    const files = new Map([[`images/${publicId}.png`, { chunks: [png], contentType }]]);
    const setup = deps({}, files);
    const response = await serveMedia(setup.base, publicId, null);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.deepEqual(setup.cancelled, [`images/${publicId}.png`], `a ${contentType} body must not be consumed`);
  }
});

test('S2: storage failures, missing blobs and missing configuration are the same empty 404', async () => {
  const throwing = deps({ blobGet: async () => { throw new Error('storage failure: bucket xyz and token leak'); } });
  const failure = await serveMedia(throwing.base, publicId, null);
  assert.equal(failure.status, 404);
  assert.equal(await failure.text(), '');
  const missing = deps({ blobGet: async () => null });
  assert.equal((await serveMedia(missing.base, publicId, null)).status, 404);
  const noToken = deps({ token: '' });
  const unconfigured = await serveMedia(noToken.base, publicId, null);
  assert.equal(unconfigured.status, 404);
  assert.equal(await unconfigured.text(), '');
  assert.deepEqual(noToken.calls, [], 'a missing storage token must not reach the provider');
  const noDatabase = deps({ databaseUrl: undefined });
  assert.equal((await serveMedia(noDatabase.base, publicId, null)).status, 404);
});

test('S2: the provider body passes through byte for byte', async () => {
  const big = Uint8Array.from({ length: 64 * 1024 }, (_, i) => i % 256);
  const files = new Map([[`images/${publicId}.png`, { chunks: [big, big, big], contentType: 'image/png' }]]);
  const setup = deps({}, files);
  const response = await serveMedia(setup.base, publicId, null);
  assert.equal(response.status, 200);
  // A ReadableStream body alone proves nothing about buffering; the pull-count
  // regression below is what establishes that the route never drains the provider.
  assert.ok(response.body instanceof ReadableStream, 'expected the response to expose the provider body');
  const bytes = await bodyBytes(response);
  assert.equal(bytes.byteLength, 3 * big.byteLength);
  for (let i = 0; i < big.byteLength; i += 1) {
    assert.equal(bytes[i], big[i]);
    assert.equal(bytes[big.byteLength + i], big[i]);
  }
});

// ---------------------------------------------------------------------------
// Independent-verifier probes promoted to durable regressions.
// Additional imports for these tests (add to the import block at the top):
//   import { drizzle } from 'drizzle-orm/libsql';
//   import { publishDraft, unpublishDraft } from '../src/lib/drafts.ts';
import { drizzle } from 'drizzle-orm/libsql';
import { SignJWT } from 'jose';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { publishDraft, unpublishDraft } from '../src/lib/drafts.ts';

const authedDb = drizzle(client);

/** Self-contained draft post whose markdown and cover reference one owned image. */
async function insertLifecyclePost(postId: string, slug: string, id: string) {
  const stamp = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
          VALUES (?, ?, 'T', 'E', ?, '["P"]', ?, 'draft', ?, ?, NULL)`,
    args: [postId, slug, `# C\n\n![imagen](/media/${id})`, `/media/${id}`, stamp, stamp],
  });
  await client.execute({ sql: 'INSERT INTO media (id, post_id, storage_path) VALUES (?, ?, ?)', args: [id, postId, `images/${id}.png`] });
  return new Map([[`images/${id}.png`, { chunks: [png], contentType: 'image/png' }]]);
}

test('S2: publishing serves the image anonymously and unpublishing ("Volver a privadas") takes it back', async () => {
  const id = 'abcdefab-1111-4222-8333-444444444444';
  const postId = 'lifecycle-a';
  const files = await insertLifecyclePost(postId, 'lifecycle-a', id);

  const before = deps({}, files);
  assert.equal((await serveMedia(before.base, id, null)).status, 404, 'a draft image must start private');
  assert.deepEqual(before.calls, []);

  await publishDraft(authedDb, postId);
  const published = deps({}, files);
  const served = await serveMedia(published.base, id, null);
  assert.equal(served.status, 200, 'published membership must serve anonymously');
  assert.match(served.headers.get('cache-control') ?? '', /public/);
  assert.deepEqual(published.calls.map(call => call.pathname), [`images/${id}.png`]);
  assert.deepEqual(await bodyBytes(served), png);

  await unpublishDraft(authedDb, postId);
  const after = deps({}, files);
  const denied = await serveMedia(after.base, id, null);
  assert.equal(denied.status, 404, 'unpublishing must stop anonymous delivery');
  assert.equal(await denied.text(), '');
  assert.deepEqual(after.calls, [], 'an unpublished image must not be fetched from storage');

  const session = deps({}, files);
  const back = await serveMedia(session.base, id, cookie);
  assert.equal(back.status, 200, 'the session path must serve the re-privatised image');
  assert.match(back.headers.get('cache-control') ?? '', /no-store/);
});

test('S2: membership rows for another post or for a draft post never publish draft media', async () => {
  const id = 'abcdefab-2222-4222-8333-444444444444';
  const postId = 'lifecycle-b';
  await insertLifecyclePost(postId, 'lifecycle-b', id);
  // published post referencing media it does not own, and the owning draft post itself
  await client.execute({ sql: 'INSERT INTO published_media (post_id, media_id) VALUES (?, ?)', args: ['published-c', id] });
  await client.execute({ sql: 'INSERT INTO published_media (post_id, media_id) VALUES (?, ?)', args: [postId, id] });
  const setup = deps();
  const response = await serveMedia(setup.base, id, null);
  assert.equal(response.status, 404, 'published_media rows must not publish media of a draft post');
  assert.equal(await response.text(), '');
  assert.deepEqual(setup.calls, []);
});

test('S2: a storage failure on the draft path is the same empty 404 and leaks no provider detail', async () => {
  const setup = deps({ blobGet: async () => { throw new Error('bucket=secret-bucket token=abc at provider.js:1'); } });
  const response = await serveMedia(setup.base, draftId, cookie);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
  assert.deepEqual([...response.headers.keys()].sort(), ['cache-control']);
});

test('S2: the route never pulls from the provider before the caller reads the body', async () => {
  const chunk = new Uint8Array(32 * 1024);
  let pulls = 0;
  const blobGet = async () => ({
    statusCode: 200 as const,
    stream: new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(chunk); } }, { highWaterMark: 0 }),
    blob: { contentType: 'image/png' },
  });
  const response = await serveMedia(deps({ blobGet }).base, publicId, null);
  assert.equal(response.status, 200);
  assert.equal(pulls, 0, 'the route consumed the provider body before the caller could read it');
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(first.value?.byteLength, chunk.byteLength);
  assert.equal(pulls, 1, 'one caller read must not pull the whole body');
  await reader.cancel();
});

test('S6: rotated-key, expired, future-issued, over-lifetime and foreign-subject tokens are rejected for drafts', async () => {
  const key = Buffer.from(secret, 'base64');
  const otherSecret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 31 + 9) % 256)).toString('base64');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sign = (claims: { sub: string; iat: number; exp: number }, signingKey: Uint8Array) => new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(claims.sub)
    .setIssuedAt(claims.iat).setExpirationTime(claims.exp).sign(signingKey);
  const bad = [
    `__Host-admin=${await createAdminSessionWithConfig({ secret: otherSecret })}`, // rotated key
    `__Host-admin=${await sign({ sub: 'admin', iat: 1, exp: 2 }, key)}`, // expired
    `__Host-admin=${await sign({ sub: 'admin', iat: nowSeconds + 3600, exp: nowSeconds + 7200 }, key)}`, // future iat
    `__Host-admin=${await sign({ sub: 'admin', iat: nowSeconds, exp: nowSeconds + 40000 }, key)}`, // over 8h
    `__Host-admin=${await sign({ sub: 'root', iat: nowSeconds, exp: nowSeconds + 3600 }, key)}`, // foreign subject
  ];
  for (const badCookie of bad) {
    const setup = deps();
    const response = await serveMedia(setup.base, draftId, badCookie);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
    assert.deepEqual(setup.calls, []);
  }
});
