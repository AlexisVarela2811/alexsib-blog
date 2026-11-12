// Durable hidden probes for the guarded publish/unpublish pair (S2/S6).
// Covers what the module suite leaves implicit: rotated-key, expired and
// duplicate session cookies, origin variants, transactional rollback when the
// write fails *after* the membership insert / status flip, membership rows never
// publishing a draft's media, the media reverting to session-only after
// unpublish, and concurrent duplicate submits.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { SignJWT } from 'jose';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as publishRoute } from '../src/app/api/admin/drafts/[id]/publish/route.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as unpublishRoute } from '../src/app/api/admin/drafts/[id]/unpublish/route.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { serveMedia } from '../src/app/media/delivery.ts';

const origin = 'https://blog.example.test';
const salt = Buffer.alloc(16, 4);
const passwordHash = `scrypt$${salt.toString('base64')}$${scryptSync('durable probe password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 1) % 256)).toString('base64');
const rotated = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 2) % 256)).toString('base64');

const dir = await mkdtemp(join(tmpdir(), 'blog-publish-atomicity-'));
const dbPath = join(dir, 'fixture.sqlite');
process.env.TURSO_DATABASE_URL = pathToFileURL(dbPath).href;
process.env.AUTH_ORIGIN = origin;
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = passwordHash;
process.env.AUTH_SESSION_SECRET = secret;
const client: Client = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}
const mediaId = randomUUID();
const now = new Date().toISOString();
await client.execute({ sql: `INSERT INTO posts (id,slug,title,excerpt,content,tags,cover_image,status,created_at,updated_at,published_at) VALUES ('atom-draft','atom-draft','Borrador atómico','R.',?,'["T"]',NULL,'draft',?,?,NULL)`, args: [`# X\n\n![a](/media/${mediaId})`, now, now] });
await client.execute({ sql: `INSERT INTO posts (id,slug,title,excerpt,content,tags,cover_image,status,created_at,updated_at,published_at) VALUES ('atom-pub','atom-pub','Publicada atómica','R.','# Y','["T"]',NULL,'published',?,?,?)`, args: [now, now, now] });
await client.execute({ sql: 'INSERT INTO media (id,post_id,storage_path) VALUES (?,?,?)', args: [mediaId, 'atom-draft', `posts/atom-draft/${mediaId}`] });
await client.execute({ sql: 'INSERT INTO published_media (post_id,media_id) VALUES (?,?)', args: ['atom-pub', mediaId] });

after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const rejection = { publish: 'No se pudo publicar el artículo', unpublish: 'No se pudo despublicar el artículo' };
const fileHash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
const statusOf = async (id: string) => String((await client.execute({ sql: 'SELECT status FROM posts WHERE id = ?', args: [id] })).rows[0]?.status);
const membership = async (id: string) => (await client.execute({ sql: 'SELECT media_id FROM published_media WHERE post_id = ? ORDER BY media_id', args: [id] })).rows.map(row => String(row.media_id));
type Opts = { cookie?: string | null; origin?: string | null };
function request(id: string, o: Opts = {}) {
  const headers = new Headers();
  if (o.cookie !== null) headers.set('cookie', o.cookie ?? cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? origin);
  return new Request(`${origin}/api/admin/drafts/${id}`, { method: 'POST', headers });
}
const publish = (id: string, o?: Opts) => publishRoute(request(id, o), { params: Promise.resolve({ id }) });
const unpublish = (id: string, o?: Opts) => unpublishRoute(request(id, o), { params: Promise.resolve({ id }) });
async function assertRejected(action: 'publish' | 'unpublish', o: Opts, label: string) {
  const before = fileHash();
  const response = await (action === 'publish' ? publish('atom-draft', o) : unpublish('atom-pub', o));
  assert.equal(response.status, 400, label);
  assert.equal(await response.text(), rejection[action], label);
  assert.equal(response.headers.get('cache-control'), 'no-store', label);
  assert.equal(response.headers.get('location'), null, label);
  assert.equal(fileHash(), before, `${label}: stored bytes must not change`);
}

const mediaDeps = () => ({ databaseUrl: process.env.TURSO_DATABASE_URL, token: 'probe-token', origin, username: 'admin', passwordHash, sessionSecret: secret,
  blobGet: async () => ({ statusCode: 200 as const, blob: { contentType: 'image/png' }, stream: new Blob(['png']).stream() }) });
const anonymousMedia = async (id: string) => (await serveMedia(mediaDeps(), id, undefined)).status;
const sessionMedia = async (id: string) => serveMedia(mediaDeps(), id, cookie);

test('S6: expired, rotated-key and duplicate session cookies are rejected like a forged one', async () => {
  const key = Buffer.from(secret, 'base64');
  const issued = Math.floor(Date.now() / 1000) - 9 * 3600;
  const expired = `__Host-admin=${await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject('admin').setIssuedAt(issued).setExpirationTime(issued + 8 * 3600).sign(key)}`;
  const rotatedCookie = `__Host-admin=${await createAdminSessionWithConfig({ secret: rotated })}`;
  for (const [label, value] of [['expired', expired], ['rotated key', rotatedCookie], ['duplicate', `${cookie}; ${cookie}`]] as [string, string][]) {
    await assertRejected('publish', { cookie: value }, `publish with ${label} cookie`);
    await assertRejected('unpublish', { cookie: value }, `unpublish with ${label} cookie`);
  }
});

test('S6: the origin must match the configured value exactly', async () => {
  for (const value of [`${origin}/`, 'http://blog.example.test', 'https://app.blog.example.test', 'null', '', 'https://blog.example.test:443']) {
    await assertRejected('publish', { origin: value }, `publish with origin ${JSON.stringify(value)}`);
    await assertRejected('unpublish', { origin: value }, `unpublish with origin ${JSON.stringify(value)}`);
  }
  await assertRejected('publish', { origin: null }, 'publish without an origin header');
});

test('S2: a publish that fails after writing membership rolls back completely', async () => {
  await client.execute("CREATE TRIGGER probe_block_publish BEFORE UPDATE ON posts WHEN NEW.status = 'published' BEGIN SELECT RAISE(ABORT, 'probe'); END");
  try {
    const before = fileHash();
    const response = await publish('atom-draft');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection.publish);
    assert.equal(fileHash(), before, 'an aborted publish must not leave the membership insert behind');
    assert.equal(await statusOf('atom-draft'), 'draft');
    assert.deepEqual(await membership('atom-draft'), []);
  } finally { await client.execute('DROP TRIGGER probe_block_publish'); }
});

test('S2: an unpublish that fails after the status flip rolls back to published with its media', async () => {
  await client.execute("CREATE TRIGGER probe_block_unpublish BEFORE DELETE ON published_media BEGIN SELECT RAISE(ABORT, 'probe'); END");
  try {
    const before = fileHash();
    const response = await unpublish('atom-pub');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejection.unpublish);
    assert.equal(fileHash(), before);
    assert.equal(await statusOf('atom-pub'), 'published');
    assert.deepEqual(await membership('atom-pub'), [mediaId]);
  } finally { await client.execute('DROP TRIGGER probe_block_unpublish'); }
});

test('S2: membership rows alone never publish a draft image, and unpublish returns images to session-only', async () => {
  await client.execute({ sql: 'INSERT INTO published_media (post_id,media_id) VALUES (?,?)', args: ['atom-draft', mediaId] });
  try {
    assert.equal(await anonymousMedia(mediaId), 404, 'a draft row with membership must stay private');
    const withSession = await sessionMedia(mediaId);
    assert.equal(withSession.status, 200);
    assert.equal(withSession.headers.get('cache-control'), 'private, no-store');
  } finally { await client.execute({ sql: 'DELETE FROM published_media WHERE post_id = ?', args: ['atom-draft'] }); }

  assert.equal((await publish('atom-draft')).status, 303);
  assert.deepEqual(await membership('atom-draft'), [mediaId]);
  const shared = await serveMedia(mediaDeps(), mediaId, undefined);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get('cache-control'), 'public, max-age=60');

  assert.equal((await unpublish('atom-draft')).status, 303);
  assert.equal(await anonymousMedia(mediaId), 404, 'after unpublish the image is private again');
  assert.equal((await sessionMedia(mediaId)).status, 200);
});

test('S2: a published article whose membership vanished stays private and still unpublishes', async () => {
  const vanished = randomUUID();
  await client.execute({ sql: 'INSERT INTO media (id,post_id,storage_path) VALUES (?,?,?)', args: [vanished, 'atom-pub', `posts/atom-pub/${vanished}`] });
  await client.execute({ sql: 'DELETE FROM published_media WHERE post_id = ?', args: ['atom-pub'] });
  assert.equal(await anonymousMedia(vanished), 404);
  assert.equal((await unpublish('atom-pub')).status, 303);
  assert.equal(await statusOf('atom-pub'), 'draft');
  assert.deepEqual(await membership('atom-pub'), []);
});

test('S2: two concurrent publishes never publish twice or leave a partial state', async () => {
  await client.execute({ sql: `UPDATE posts SET status = 'draft', published_at = NULL WHERE id = 'atom-draft'`, args: [] });
  await client.execute({ sql: 'DELETE FROM published_media WHERE post_id = ?', args: ['atom-draft'] });
  const responses = await Promise.all([publish('atom-draft'), publish('atom-draft')]);
  const codes = responses.map(response => response.status);
  assert.ok(codes.filter(code => code === 303).length <= 1, `at most one success, got ${codes}`);
  for (const code of codes) assert.ok(code === 303 || code === 400, `only 303/400, got ${codes}`);
  const status = await statusOf('atom-draft');
  assert.deepEqual(await membership('atom-draft'), status === 'published' ? [mediaId] : []);
  assert.equal(codes.includes(303), status === 'published');
});
