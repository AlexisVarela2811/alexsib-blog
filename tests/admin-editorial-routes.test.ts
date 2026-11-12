// Guarded private editor session and save route. Runs standalone with Node's
// native TypeScript runner, without spawning Next: it imports the route handler
// and session modules directly and keeps all state inside a temp directory that
// this file removes when it ends.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scryptSync, randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { loadEditorDraft, loadPreviewDraft } from '../src/app/admin/editorial-session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST } from '../src/app/api/admin/drafts/[id]/route.ts';

const origin = 'https://blog.example.test';
const password = 'synthetic test password';
const salt = Buffer.alloc(16, 2);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 11) % 256)).toString('base64');
const rejectionBody = 'No se pudieron guardar los cambios';
const edited = {
  title: 'Título editado',
  slug: 'borrador-privado',
  excerpt: 'Resumen editado.',
  tags: 'Pruebas, Editada',
  markdown: '# Hola\n\nContenido actualizado.',
};

const dir = await mkdtemp(join(tmpdir(), 'blog-editor-routes-'));
process.env.TURSO_DATABASE_URL = pathToFileURL(join(dir, 'fixture.sqlite')).href;
process.env.AUTH_ORIGIN = origin;
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = hash;
process.env.AUTH_SESSION_SECRET = secret;
const client: Client = createClient({ url: process.env.TURSO_DATABASE_URL });
for (const name of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) {
  await client.executeMultiple(readFileSync(join('drizzle', name), 'utf8'));
}
async function insertDraft(id: string, slug: string, title: string, content: string, coverImage: string | null) {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
    args: [id, slug, title, 'Resumen del borrador.', content, '["Pruebas"]', coverImage, now, now],
  });
}
await insertDraft('fixture-draft', 'borrador-privado', 'Borrador privado de prueba', '# Hola\n\nPrimera versión guardada.', null);
await insertDraft('fixture-legacy', 'borrador-heredado', 'Borrador con portada heredada', '# Portada\n\nContenido con portada HTTPS.', 'https://example.com/legacy.png');
await insertDraft('fixture-managed', 'borrador-gestionado', 'Borrador con portada propia', '# Portada\n\nContenido con imagen propia.', `/media/${randomUUID()}`);
const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;

after(async () => {
  client.close();
  await rm(dir, { recursive: true, force: true });
});

function row(id: { args: string[] } | null, draftId: string) {
  return client.execute({
    sql: 'SELECT slug, title, excerpt, content, tags, cover_image FROM posts WHERE id = ?',
    args: [draftId],
  });
}

function saveRequest({ id = 'fixture-draft', requestOrigin = origin as string | null, requestCookie = cookie as string | null, body = JSON.stringify(edited) } = {}) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set('origin', requestOrigin);
  if (requestCookie !== null) headers.set('cookie', requestCookie);
  return new Request(`https://blog.example.test/api/admin/drafts/${id}`, { method: 'POST', headers, body });
}

test('valid session and exact origin save an edit and keep the cover comparison', async () => {
  const response = await POST(saveRequest(), { params: Promise.resolve({ id: 'fixture-draft' }) });
  assert.equal(response.status, 200);
  const stored = await row(null, 'fixture-draft');
  assert.equal(stored.rows[0].title, edited.title);
  assert.equal(stored.rows[0].excerpt, edited.excerpt);
  assert.deepEqual(JSON.parse(String(stored.rows[0].tags)), ['Pruebas', 'Editada']);
  assert.equal(stored.rows[0].content, edited.markdown);
  assert.equal(stored.rows[0].cover_image ?? null, null);
  // The controller must compare the cover it read, so a legacy HTTPS cover survives.
  const legacy = await POST(saveRequest({ id: 'fixture-legacy', body: JSON.stringify({ ...edited, slug: 'borrador-heredado' }) }), { params: Promise.resolve({ id: 'fixture-legacy' }) });
  assert.equal(legacy.status, 200);
  const legacyRow = await row(null, 'fixture-legacy');
  assert.equal(legacyRow.rows[0].cover_image, 'https://example.com/legacy.png');
  const managed = await POST(saveRequest({ id: 'fixture-managed', body: JSON.stringify({ ...edited, slug: 'borrador-gestionado' }) }), { params: Promise.resolve({ id: 'fixture-managed' }) });
  assert.equal(managed.status, 200);
  const managedRow = await row(null, 'fixture-managed');
  assert.match(String(managedRow.rows[0].cover_image), /^\/media\/[0-9a-f-]{36}$/);
});

test('wrong origin, missing cookie and forged session are rejected generically without saving', async () => {
  const before = await row(null, 'fixture-draft');
  for (const request of [
    saveRequest({ requestOrigin: 'https://evil.test' }),
    saveRequest({ requestOrigin: null }),
    saveRequest({ requestCookie: null }),
    saveRequest({ requestCookie: '__Host-admin=not-the-real-token' }),
  ]) {
    const response = await POST(request, { params: Promise.resolve({ id: 'fixture-draft' }) });
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejectionBody);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const afterAll = await row(null, 'fixture-draft');
  assert.deepEqual(afterAll.rows, before.rows);
});

test('malformed, oversized and invalid bodies are rejected generically without saving', async () => {
  const before = await row(null, 'fixture-draft');
  for (const body of ['not json', JSON.stringify({ ...edited, slug: 'Título inválido' }), JSON.stringify(edited).padEnd(1_600_000, 'x'), JSON.stringify(null)]) {
    const response = await POST(saveRequest({ body }), { params: Promise.resolve({ id: 'fixture-draft' }) });
    assert.equal(response.status, 400);
    assert.equal(await response.text(), rejectionBody);
  }
  const afterAll = await row(null, 'fixture-draft');
  assert.deepEqual(afterAll.rows, before.rows);
});

test('unknown draft and unusable storage are rejected generically', async () => {
  const response = await POST(saveRequest({ id: 'missing-draft' }), { params: Promise.resolve({ id: 'missing-draft' }) });
  assert.equal(response.status, 400);
  assert.equal(await response.text(), rejectionBody);
  const previousUrl = process.env.TURSO_DATABASE_URL;
  try {
    delete process.env.TURSO_DATABASE_URL;
    const offline = await POST(saveRequest(), { params: Promise.resolve({ id: 'fixture-draft' }) });
    assert.equal(offline.status, 400);
  } finally {
    process.env.TURSO_DATABASE_URL = previousUrl;
  }
});

test('editor and preview loads are guarded and fail closed', async () => {
  const session = await loadEditorDraft(cookie, 'fixture-draft');
  assert.equal(session.unauthorized, false);
  const stored = await row(null, 'fixture-draft');
  assert.deepEqual(session.values, {
    title: edited.title, slug: edited.slug, excerpt: edited.excerpt,
    tags: 'Pruebas, Editada', markdown: edited.markdown,
  });
  assert.equal(stored.rows.length, 1);
  const preview = await loadPreviewDraft(cookie, 'fixture-draft');
  assert.deepEqual(preview, {
    unauthorized: false,
    draft: { title: edited.title, excerpt: edited.excerpt, tags: ['Pruebas', 'Editada'], content: edited.markdown },
  });
  for (const bad of [undefined, '', '__Host-admin=not-the-real-token']) {
    assert.deepEqual(await loadEditorDraft(bad, 'fixture-draft'), { unauthorized: true });
    assert.deepEqual(await loadPreviewDraft(bad, 'fixture-draft'), { unauthorized: true });
  }
  assert.deepEqual(await loadEditorDraft(cookie, 'missing-draft'), { unauthorized: false, values: null });
  assert.deepEqual(await loadPreviewDraft(cookie, 'missing-draft'), { unauthorized: false, draft: null });
  const previousUrl = process.env.TURSO_DATABASE_URL;
  try {
    delete process.env.TURSO_DATABASE_URL;
    for (const outcome of [await loadEditorDraft(cookie, 'fixture-draft'), await loadPreviewDraft(cookie, 'fixture-draft')]) {
      assert.equal(outcome.unauthorized, true);
      assert.equal('draft' in outcome || 'values' in outcome, false);
    }
  } finally {
    process.env.TURSO_DATABASE_URL = previousUrl;
  }
});
