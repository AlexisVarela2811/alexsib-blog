// Durable probes for the guarded create-draft route (S2/S6): creating an
// article from the private panel. Covers authorization before a single body
// byte, the exact origin, JSON-only bodies, unknown keys, the streaming byte
// cap, slug derivation from a Spanish title, duplicate slugs and the created
// draft reading back through the authorized editor path.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAdminSessionWithConfig } from '../src/lib/auth/session.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { POST as createRoute } from '../src/app/api/admin/drafts/route.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { loadEditorDraft } from '../src/app/admin/editorial-session.ts';

const origin = 'https://blog.example.test';
const salt = Buffer.alloc(16, 6);
const passwordHash = `scrypt$${salt.toString('base64')}$${scryptSync('create probe password', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256)).toString('base64');

const dir = await mkdtemp(join(tmpdir(), 'blog-create-draft-'));
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

after(async () => { client.close(); await rm(dir, { recursive: true, force: true }); });

const cookie = `__Host-admin=${await createAdminSessionWithConfig({ secret })}`;
const rejection = 'No se pudo crear el artículo';
const count = async () => Number((await client.execute('SELECT COUNT(*) AS n FROM posts')).rows[0]?.n ?? -1);

const valid = {
  title: 'El contexto de un modelo',
  slug: 'el-contexto-de-un-modelo',
  excerpt: 'Un resumen corto.',
  tags: 'uno, dos',
  markdown: '# Hola\n\nTexto.',
};

type Options = { cookie?: string | null; origin?: string | null; contentType?: string | null };
function request(body: string, options: Options = {}) {
  const headers = new Headers();
  if (options.cookie !== null) headers.set('cookie', options.cookie ?? cookie);
  if (options.origin !== null) headers.set('origin', options.origin ?? origin);
  if (options.contentType !== null) headers.set('content-type', options.contentType ?? 'application/json');
  return new Request(`${origin}/api/admin/drafts`, { method: 'POST', headers, body });
}
const create = (body: string | object, options?: Options) =>
  createRoute(request(typeof body === 'string' ? body : JSON.stringify(body), options));

async function assertRejected(body: string | object, options: Options, label: string) {
  const before = await count();
  const response = await create(body, options);
  assert.equal(response.status, 400, label);
  assert.equal(await response.text(), rejection, label);
  assert.equal(response.headers.get('cache-control'), 'no-store', label);
  assert.equal(await count(), before, `${label}: no article may be created`);
}

test('S6: creating requires the session cookie and the exact origin, checked before the body', async () => {
  await assertRejected(valid, { cookie: null }, 'without a cookie');
  await assertRejected(valid, { cookie: 'forged-cookie' }, 'with a forged cookie');
  await assertRejected(valid, { origin: null }, 'without an origin');
  for (const value of [`${origin}/`, 'http://blog.example.test', 'https://app.blog.example.test', '']) {
    await assertRejected(valid, { origin: value }, `with origin ${JSON.stringify(value)}`);
  }
  // An oversized body from an unauthorized caller must never be read: the
  // authorization answer arrives with the same generic rejection.
  await assertRejected('x'.repeat(2_000_000), { cookie: null }, 'oversized anonymous body');
});

test('S6: only a JSON body carrying the editor keys is accepted', async () => {
  await assertRejected(valid, { contentType: 'text/plain' }, 'with a text body');
  await assertRejected(valid, { contentType: null }, 'without a content type');
  await assertRejected({ ...valid, status: 'published' }, {}, 'with an unknown key');
  await assertRejected({ ...valid, cover: null }, {}, 'with a cover instruction');
  await assertRejected('not json', {}, 'with a malformed body');
  await assertRejected('x'.repeat(1_600_000), {}, 'over the byte cap');
  await assertRejected({ ...valid, title: '' }, {}, 'with an empty title');
  await assertRejected({ ...valid, markdown: '' }, {}, 'with empty content');
});

test('S2: a valid create answers the new id and the draft reads back through the editor path', async () => {
  const response = await create(valid);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { id?: unknown };
  assert.equal(typeof body.id, 'string');
  const id = body.id as string;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const outcome = await loadEditorDraft(cookie, id);
  assert.equal(outcome.unauthorized, false);
  if (outcome.unauthorized || !outcome.values) throw new Error('the created draft must be readable');
  assert.equal(outcome.values.title, valid.title);
  assert.equal(outcome.values.slug, valid.slug);
  assert.equal(outcome.values.excerpt, valid.excerpt);
  assert.equal(outcome.values.tags, 'uno, dos');
  assert.equal(outcome.values.markdown, valid.markdown);
  assert.equal(outcome.cover, null);
});

test('S2: a missing slug is derived from the title and never reuses an existing one', async () => {
  const before = await count();
  const response = await create({ ...valid, slug: '  ', title: 'Cómo funciona el contexto de un modelo' });
  assert.equal(response.status, 200);
  const { id } = await response.json() as { id: string };
  const outcome = await loadEditorDraft(cookie, id);
  if (outcome.unauthorized || !outcome.values) throw new Error('the created draft must be readable');
  assert.equal(outcome.values.slug, 'como-funciona-el-contexto-de-un-modelo');

  await assertRejected({ ...valid, title: 'Otro título' }, {}, 'with a duplicate slug');
  assert.equal(await count(), before + 1, 'only the successful create may add a row');
});
