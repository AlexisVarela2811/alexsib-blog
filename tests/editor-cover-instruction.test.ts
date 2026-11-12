// Explicit cover instructions for private drafts: an authorized save may clear
// the cover (null) or set a blog-managed /media/<uuid> cover, while a save that
// says nothing about the cover preserves the stored cover exactly, including a
// legacy external HTTPS one. Anything still rejected — an external URL set as a
// new cover, a malformed path, a wrong type or an unknown key — fails with the
// generic rejection and leaves the stored row untouched. Covers S2 (draft image
// privacy: "No, solo imágenes del blog" and publishing fails closed until the
// legacy cover is removed). Runs standalone with Node's native TypeScript
// runner, without spawning Next, and keeps all state inside one temp directory
// that this file removes when it ends.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, scryptSync } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialPersistence, createEditorialService } from '../src/lib/editorial/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorController } from '../src/lib/editorial/editor-controller.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { loadEditorDraft, loadPanelArticles } from '../src/app/admin/editorial-session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as savePOST } from '../src/app/api/admin/drafts/[id]/route.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as publishPOST } from '../src/app/api/admin/drafts/[id]/publish/route.ts';

const origin = 'https://blog.example.test';
const rejectionBody = 'No se pudieron guardar los cambios';
const password = 'synthetic test password';
const salt = Buffer.alloc(16, 5);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 17 + 5) % 256)).toString('base64');
const managedPath = `/media/${randomUUID()}`;
const edited = {
  title: 'Título editado', slug: 'borrador-legacy', excerpt: 'Resumen editado.',
  tags: 'Pruebas, Editada', markdown: '# Editado',
};

const dir = await mkdtemp(join(tmpdir(), 'blog-cover-instruction-'));
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
const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const now = new Date().toISOString();
async function insertDraft(id: string, slug: string, coverImage: string | null) {
  await client.execute({
    sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
          VALUES (?, ?, ?, 'Resumen.', '# Hola', '["Pruebas"]', ?, 'draft', ?, ?, NULL)`,
    args: [id, slug, 'Borrador ' + id, coverImage, now, now],
  });
}
await insertDraft('legacy', 'borrador-legacy', 'https://example.com/legacy.png');
await insertDraft('managed', 'borrador-managed', managedPath);
await insertDraft('plain', 'borrador-plain', null);
await insertDraft('ext', 'borrador-ext', null);

const rowOf = async (id: string) =>
  (await client.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [id] })).rows;
const saveRequest = (id: string, extra: Record<string, unknown> = {}) => {
  const headers = new Headers({ 'content-type': 'application/json', origin, cookie });
  return new Request(`https://blog.example.test/api/admin/drafts/${id}`, {
    method: 'POST', headers, body: JSON.stringify({ ...edited, slug: 'borrador-legacy', ...extra }),
  });
};

// Controller-level fixtures live on their own rows so route tests cannot touch them.
const db = drizzle(client);
const service = createEditorialService({
  authorizeRead: async () => true,
  authorizeMutation: async () => true,
  persistence: createEditorialPersistence(db),
});
const controller = createEditorController(service);
const createdFor = async (slug: string) =>
  (await service.create({ slug, title: 'Original', excerpt: 'Resumen', content: 'Contenido', tags: [], coverImage: null })).id;

after(async () => {
  client.close();
  await rm(dir, { recursive: true, force: true });
});

test('an explicit null instruction clears a legacy external cover through the controller', async () => {
  await createdFor('control-clear');
  const target = (await client.execute({ sql: 'SELECT id FROM posts WHERE slug = ?', args: ['control-clear'] })).rows[0];
  await client.execute({ sql: 'UPDATE posts SET cover_image = ? WHERE id = ?', args: ['https://example.com/legacy.png', target.id] });
  const values = { title: 'Sin portada', slug: 'control-clear', excerpt: 'Resumen', tags: 'Uno', markdown: '# Sin portada' };
  await controller.edit(target.id as string, values, null);
  const row = (await rowOf(target.id as string))[0];
  assert.equal(row.cover_image ?? null, null);
  assert.equal(row.title, 'Sin portada');
});

test('an explicit blog-managed path sets the cover through the controller', async () => {
  await createdFor('control-managed');
  const target = (await client.execute({ sql: 'SELECT id FROM posts WHERE slug = ?', args: ['control-managed'] })).rows[0];
  await client.execute({ sql: 'UPDATE posts SET cover_image = ? WHERE id = ?', args: ['https://example.com/old.png', target.id] });
  const values = { title: 'Con portada', slug: 'control-managed', excerpt: 'Resumen', tags: 'Uno', markdown: '# Con portada' };
  await controller.edit(target.id as string, values, managedPath);
  const row = (await rowOf(target.id as string))[0];
  assert.equal(row.cover_image, managedPath);
});

test('an external URL set as a new cover is rejected by the controller and touches nothing', async () => {
  await createdFor('control-ext');
  const target = (await client.execute({ sql: 'SELECT id FROM posts WHERE slug = ?', args: ['control-ext'] })).rows[0];
  const before = await rowOf(target.id as string);
  const values = { title: 'Externa', slug: 'control-ext', excerpt: 'Resumen', tags: 'Uno', markdown: '# Externa' };
  await assert.rejects(() => controller.edit(target.id as string, values, 'https://example.com/external.png'), { message: 'Editorial operation failed' });
  assert.deepEqual(await rowOf(target.id as string), before);
});

test('a malformed managed path is rejected by the controller and touches nothing', async () => {
  await createdFor('control-malformed');
  const target = (await client.execute({ sql: 'SELECT id FROM posts WHERE slug = ?', args: ['control-malformed'] })).rows[0];
  const before = await rowOf(target.id as string);
  const values = { title: 'Malformada', slug: 'control-malformed', excerpt: 'Resumen', tags: 'Uno', markdown: '# Malformada' };
  await assert.rejects(() => controller.edit(target.id as string, values, '/media/not-a-uuid'), { message: 'Editorial operation failed' });
  assert.deepEqual(await rowOf(target.id as string), before);
});

test('the session exposes the stored cover to the editor without extra details', async () => {
  const legacyOutcome = await loadEditorDraft(cookie, 'legacy');
  assert.equal(legacyOutcome.unauthorized, false);
  if (legacyOutcome.unauthorized || !legacyOutcome.values) throw new Error('expected values');
  assert.equal(legacyOutcome.cover, 'https://example.com/legacy.png');
  const managedOutcome = await loadEditorDraft(cookie, 'managed');
  if (managedOutcome.unauthorized || !managedOutcome.values) throw new Error('expected values');
  assert.equal(managedOutcome.cover, managedPath);
  const plainOutcome = await loadEditorDraft(cookie, 'plain');
  if (plainOutcome.unauthorized || !plainOutcome.values) throw new Error('expected values');
  assert.equal(plainOutcome.cover, null);
});

test('the panel flags only the draft whose cover is a legacy external URL', async () => {
  const panel = await loadPanelArticles(cookie);
  assert.equal(panel.unauthorized, false);
  if (panel.unauthorized || !panel.drafts) throw new Error('expected drafts');
  const byId = new Map(panel.drafts.map(draft => [draft.id, draft]));
  assert.equal(byId.get('legacy')?.legacyCover, true);
  assert.equal(byId.get('managed')?.legacyCover, undefined);
  assert.equal(byId.get('plain')?.legacyCover, undefined);
});

test('the save route keeps rejecting unknown keys even beside the new cover key', async () => {
  const before = await rowOf('legacy');
  const response = await savePOST(saveRequest('legacy', { cover: null, sneaky: 'x' }), { params: Promise.resolve({ id: 'legacy' }) });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejectionBody);
  assert.deepEqual(await rowOf('legacy'), before);
});

test('the save route rejects an external URL cover instruction generically and touches nothing', async () => {
  const before = await rowOf('ext');
  const response = await savePOST(saveRequest('ext', { cover: 'https://example.com/external.png' }), { params: Promise.resolve({ id: 'ext' }) });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejectionBody);
  assert.deepEqual(await rowOf('ext'), before);
});

test('the save route rejects a malformed and a non-string cover instruction without touching the row', async () => {
  const before = await rowOf('ext');
  for (const cover of ['/media/not-a-uuid', '/media/', 42]) {
    const response = await savePOST(saveRequest('ext', { cover }), { params: Promise.resolve({ id: 'ext' }) });
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejectionBody);
    assert.deepEqual(await rowOf('ext'), before);
  }
});

test('the save route sets a blog-managed path as the cover', async () => {
  const response = await savePOST(saveRequest('plain', { cover: managedPath, slug: 'borrador-plain' }), { params: Promise.resolve({ id: 'plain' }) });
  assert.equal(response.status, 200);
  const row = (await rowOf('plain'))[0];
  assert.equal(row.cover_image, managedPath);
});

test('a save without a cover key preserves the stored cover, including a legacy one', async () => {
  const response = await savePOST(saveRequest('legacy'), { params: Promise.resolve({ id: 'legacy' }) });
  assert.equal(response.status, 200);
  const row = (await rowOf('legacy'))[0];
  assert.equal(row.cover_image, 'https://example.com/legacy.png');
  assert.equal(row.title, edited.title);
});

test('a cleared legacy cover lets the draft publish and the panel stops blocking it', async () => {
  const response = await savePOST(saveRequest('legacy', { cover: null }), { params: Promise.resolve({ id: 'legacy' }) });
  assert.equal(response.status, 200);
  const row = (await rowOf('legacy'))[0];
  assert.equal(row.cover_image ?? null, null);
  const publishHeaders = new Headers({ cookie, origin });
  const published = await publishPOST(
    new Request('https://blog.example.test/api/admin/drafts/legacy/publish', { method: 'POST', headers: publishHeaders }),
    { params: Promise.resolve({ id: 'legacy' }) },
  );
  assert.equal(published.status, 303);
  const after = (await rowOf('legacy'))[0];
  assert.equal(after.status, 'published');
  const panel = await loadPanelArticles(cookie);
  if (panel.unauthorized || !panel.drafts || !panel.published) throw new Error('expected lists');
  assert.ok(!panel.drafts.some(draft => draft.id === 'legacy'));
  assert.equal(panel.published.find(article => article.id === 'legacy')?.legacyCover, undefined);
});
