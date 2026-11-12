// Guarded publish and unpublish routes for the private panel, plus the
// authorized panel listing. Covers S2 (publish/unpublish lifecycle, draft
// image privacy: membership only while published) and S6 (session cookie AND
// exact origin on every mutation, generic rejection, no internal detail).
// Runs standalone with Node's native TypeScript runner, without spawning Next:
// it imports the route handlers and session modules directly and keeps all
// state inside a temp directory that this file removes when it ends.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { scryptSync } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { loadPanelArticles } from '../src/app/admin/editorial-session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as publishRoute } from '../src/app/api/admin/drafts/[id]/publish/route.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as unpublishRoute } from '../src/app/api/admin/drafts/[id]/unpublish/route.ts';

const origin = 'https://blog.example.test';
const salt = Buffer.alloc(16, 9);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync('synthetic test password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 256)).toString('base64');
const publishRejection = 'No se pudo publicar el artículo';
const unpublishRejection = 'No se pudo despublicar el artículo';

const dir = await mkdtemp(join(tmpdir(), 'blog-publish-flow-'));
const dbPath = join(dir, 'fixture.sqlite');
process.env.TURSO_DATABASE_URL = pathToFileURL(dbPath).href;
process.env.AUTH_ORIGIN = origin;
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = hash;
process.env.AUTH_SESSION_SECRET = secret;
const client: Client = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}

// Media ownership fixtures: m1 belongs to pub-media, m2 belongs to unp-target,
// so pub-orphan references an image it does not own and must never publish it.
const m1 = randomUUID();
const m2 = randomUUID();
const now = new Date().toISOString();
async function insertPost(id: string, slug: string, status: 'draft' | 'published', content: string) {
  await client.execute({
    sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
          VALUES (?, ?, ?, 'Resumen.', ?, '["Pruebas"]', NULL, ?, ?, ?, ?)`,
    args: [id, slug, 'Titulo ' + id, content, status, now, now, status === 'published' ? now : null],
  });
}
async function insertMedia(id: string, postId: string) {
  await client.execute({
    sql: 'INSERT INTO media (id, post_id, storage_path) VALUES (?, ?, ?)',
    args: [id, postId, `posts/${postId}/${id}`],
  });
}
await insertPost('pub-a', 'publicar-simple', 'draft', '# Simple\n\nSin imágenes.');
await insertPost('pub-media', 'publicar-imagen', 'draft', `# Con imagen\n\n![Ilustración](/media/${m1})`);
await insertPost('pub-orphan', 'publicar-ajena', 'draft', `# Imagen ajena\n\n![Otra](/media/${m2})`);
await insertPost('unp-target', 'despublicar-objetivo', 'published', `# Publicado\n\n![Foto](/media/${m2})`);
await insertPost('unp-draft', 'despublicar-borrador', 'draft', '# Borrador\n\nNunca publicado.');
await insertMedia(m1, 'pub-media');
await insertMedia(m2, 'unp-target');
await client.execute({ sql: 'INSERT INTO published_media (post_id, media_id) VALUES (?, ?)', args: ['unp-target', m2] });

const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const fileHash = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
type ReqOpts = { cookie?: string | null; origin?: string | null; body?: string | null };
function request(id: string, o: ReqOpts = {}) {
  const headers = new Headers();
  if (o.cookie !== null) headers.set('cookie', o.cookie ?? cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? origin);
  return new Request(`${origin}/api/admin/drafts/${id}`, {
    method: 'POST', headers,
    body: o.body === null ? undefined : o.body ?? null,
  } as RequestInit);
}
const publish = (id: string, o?: ReqOpts) => publishRoute(request(id, o), { params: Promise.resolve({ id }) });
const unpublish = (id: string, o?: ReqOpts) => unpublishRoute(request(id, o), { params: Promise.resolve({ id }) });
const statusOf = async (id: string) => (await client.execute({ sql: 'SELECT status, published_at FROM posts WHERE id = ?', args: [id] })).rows[0];
const membership = (postId: string) => client.execute({ sql: 'SELECT media_id FROM published_media WHERE post_id = ?', args: [postId] });

after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

test('S6: publishing without a session, exact origin or usable configuration fails generically without writing', async () => {
  const before = fileHash();
  for (const bad of [
    publish('pub-a', { cookie: null }),
    publish('pub-a', { cookie: '__Host-admin=forged' }),
    publish('pub-a', { origin: 'https://evil.example' }),
    publish('pub-a', { origin: null }),
  ]) {
    const response = await bad;
    assert.equal(response.status, 400);
    assert.equal(await response.text(), publishRejection);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
  }
  const saved = { origin: process.env.AUTH_ORIGIN, secret: process.env.AUTH_SESSION_SECRET };
  delete process.env.AUTH_ORIGIN;
  delete process.env.AUTH_SESSION_SECRET;
  try {
    const response = await publish('pub-a');
    assert.equal(response.status, 400);
    assert.equal(await response.text(), publishRejection);
  } finally {
    process.env.AUTH_ORIGIN = saved.origin;
    process.env.AUTH_SESSION_SECRET = saved.secret;
  }
  assert.equal(fileHash(), before);
  assert.equal((await statusOf('pub-a')).status, 'draft');
});

test('S2: an authorized publish returns 303 to the panel, publishes the draft and writes only owned media membership', async () => {
  const simple = await publish('pub-a');
  assert.equal(simple.status, 303);
  assert.equal(simple.headers.get('location'), '/admin');
  assert.equal(simple.headers.get('cache-control'), 'no-store');
  assert.equal(await simple.text(), '');
  const simpleRow = await statusOf('pub-a');
  assert.equal(simpleRow.status, 'published');
  assert.ok(typeof simpleRow.published_at === 'string' && simpleRow.published_at.length > 0);
  assert.deepEqual((await membership('pub-a')).rows, []);

  // These routes take no payload: an unread body must not break the flow.
  const withMedia = await publish('pub-media', { body: 'sobre=escrito' });
  assert.equal(withMedia.status, 303);
  assert.equal((await statusOf('pub-media')).status, 'published');
  const rows = (await membership('pub-media')).rows.map(row => row.media_id);
  assert.deepEqual(rows, [m1]);
});

test('S2: publishing a draft that references media it does not own is rejected with the database unchanged', async () => {
  const before = fileHash();
  const response = await publish('pub-orphan');
  assert.equal(response.status, 400);
  assert.equal(await response.text(), publishRejection);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(fileHash(), before);
  assert.equal((await statusOf('pub-orphan')).status, 'draft');
  assert.deepEqual((await membership('pub-orphan')).rows, []);
});

test('S2: publishing an already published article is rejected without changing state', async () => {
  const before = fileHash();
  const response = await publish('pub-a');
  assert.equal(response.status, 400);
  assert.equal(await response.text(), publishRejection);
  assert.equal(fileHash(), before);
  assert.equal((await statusOf('pub-a')).status, 'published');
});

test('S2: an authorized unpublish returns 303 to the panel, reverts the article and removes its media membership', async () => {
  const beforeMembership = (await membership('unp-target')).rows.map(row => row.media_id);
  assert.deepEqual(beforeMembership, [m2]);
  const response = await unpublish('unp-target');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/admin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
  const row = await statusOf('unp-target');
  assert.equal(row.status, 'draft');
  assert.equal(row.published_at, null);
  assert.deepEqual((await membership('unp-target')).rows, []);
});

test('S6: unpublishing without a session or exact origin fails generically without writing', async () => {
  const before = fileHash();
  for (const bad of [
    unpublish('unp-target', { cookie: null }),
    unpublish('unp-target', { origin: 'https://evil.example' }),
  ]) {
    const response = await bad;
    assert.equal(response.status, 400);
    assert.equal(await response.text(), unpublishRejection);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal(fileHash(), before);
  assert.equal((await statusOf('unp-target')).status, 'draft');
});

test('S2: unpublishing a draft that is not published is rejected without changing state', async () => {
  const before = fileHash();
  const response = await unpublish('unp-draft');
  assert.equal(response.status, 400);
  assert.equal(await response.text(), unpublishRejection);
  assert.equal(fileHash(), before);
  assert.equal((await statusOf('unp-draft')).status, 'draft');
});

test('S2: the authorized panel lists drafts and published articles separately; anonymous readers get nothing', async () => {
  const panel = await loadPanelArticles(cookie);
  assert.equal(panel.unauthorized, false);
  if (panel.unauthorized) return;
  assert.ok(panel.drafts !== null && panel.published !== null);
  const draftIds = panel.drafts.map(draft => draft.id);
  const publishedIds = panel.published.map(article => article.id);
  // A published article disappears from the draft list.
  assert.ok(!draftIds.includes('pub-a'));
  assert.ok(!draftIds.includes('pub-media'));
  assert.ok(draftIds.includes('pub-orphan'));
  assert.ok(draftIds.includes('unp-target'));
  assert.ok(publishedIds.includes('pub-a'));
  assert.ok(publishedIds.includes('pub-media'));
  assert.ok(!publishedIds.includes('unp-target'));
  const listed = panel.drafts.find(draft => draft.id === 'pub-orphan');
  assert.deepEqual(listed?.tags, ['Pruebas']);
  for (const bad of ['', '__Host-admin=forged']) {
    assert.equal((await loadPanelArticles(bad)).unauthorized, true);
  }
});
