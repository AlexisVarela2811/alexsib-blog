import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let server: ChildProcess;
let baseUrl: string;
let dir: string;
let url: string;
let logs = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'alexsib-http-'));
  url = pathToFileURL(join(dir, 'test.sqlite')).href;
  const migration = spawnSync('npm', ['run', 'db:migrate'], { env: { ...process.env, TURSO_DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      listener.close(() => resolve(address.port));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    env: { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '', SITE_URL: baseUrl }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', chunk => { logs += chunk; });
  server.stderr?.on('data', chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next exited with ${server.exitCode}: ${logs}`);
    try { await fetch(baseUrl); return; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  throw new Error(`Next did not start: ${logs}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise<void>(resolve => server.once('exit', () => resolve()));
    server.kill();
    await exited;
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('admin page redirects unauthenticated visitors to login', async () => {
  const response = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')!, baseUrl).pathname, '/login');
});

test('login page presents the private access form', async () => {
  const response = await fetch(`${baseUrl}/login`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
});

test('home presents the Spanish blog introduction and honest empty state', async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Alexsib Blog/);
  assert.match(html, /Aprender explicando/);
  assert.match(html, /Aún no hay artículos publicados/);
  assert.match(html, /href="#articulos"/);
  assert.match(html, /lang="es"/);
});

test('published articles are public, drafts stay private and missing slugs return 404', async () => {
  const clientModule = '../src/db/client.ts';
  const schemaModule = '../src/db/schema.ts';
  const { createDatabase } = await import(clientModule) as typeof import('../src/db/client');
  const { posts } = await import(schemaModule) as typeof import('../src/db/schema');
  const { db, client } = createDatabase(url);
  try {
    const common = { excerpt: 'Una explicación sencilla', content: '<script>alert(1)</script> texto seguro', tags: ['IA'], createdAt: '2025-01-01', updatedAt: '2025-01-01' };
    await db.insert(posts).values([{ ...common, id: '1', slug: 'publicado', title: 'Título publicado', status: 'published', publishedAt: '2025-01-01' }, { ...common, id: '2', slug: 'borrador', title: 'Título secreto', status: 'draft' }]);
  } finally { client.close(); }
  const rerun = spawnSync('npm', ['run', 'db:migrate'], { env: { ...process.env, TURSO_DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(rerun.status, 0, rerun.stderr);
  const rejected = spawnSync('npm', ['run', 'db:migrate'], { env: { ...process.env, TURSO_DATABASE_URL: 'libsql://invalid.example', TURSO_AUTH_TOKEN: '' }, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /explicit local file/);
  const home = await fetch(baseUrl); const homeHtml = await home.text();
  assert.equal(home.status, 200); assert.match(homeHtml, /Título publicado/); assert.doesNotMatch(homeHtml, /Título secreto|borrador/);
  const article = await fetch(`${baseUrl}/articulo/publicado`); const articleHtml = await article.text();
  assert.equal(article.status, 200); assert.match(articleHtml, /Título publicado/); assert.match(articleHtml, /<title>Título publicado · Alexsib Blog<\/title>/); assert.doesNotMatch(articleHtml, /<script>alert\(1\)<\/script>/);
  for (const slug of ['borrador', 'no-existe']) {
    const response = await fetch(`${baseUrl}/articulo/${slug}`); const html = await response.text();
    assert.equal(response.status, 404); assert.doesNotMatch(html, /Título secreto/);
  }
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`); const xml = await sitemap.text();
  assert.equal(sitemap.status, 200); assert.match(xml, /articulo\/publicado/); assert.doesNotMatch(xml, /borrador/);
  const about = await fetch(`${baseUrl}/sobre-mi`); assert.equal(about.status, 200); assert.match(await about.text(), /aprender en público/);
});

test('published Markdown renders the allowlisted figure safely while drafts remain private', async () => {
  const clientModule = '../src/db/client.ts';
  const schemaModule = '../src/db/schema.ts';
  const { createDatabase } = await import(clientModule) as typeof import('../src/db/client');
  const { posts } = await import(schemaModule) as typeof import('../src/db/schema');
  const { db, client } = createDatabase(url);
  const markdown = [
    '## Una explicación', '',
    'Texto **importante** y [enlace seguro](https://example.com).', '',
    '[enlace peligroso](javascript:alert%281%29)', '',
    '<img src=x onerror="alert(1)">', '',
    '<script>alert(1)</script>', '',
    '```context-window', '```',
  ].join('\n');
  try {
    const common = { excerpt: 'Conceptos de IA', tags: ['IA'], createdAt: '2025-01-01', updatedAt: '2025-01-01' };
    await db.insert(posts).values([
      { ...common, id: 'markdown-publico', slug: 'markdown-publico', title: 'Markdown público', content: markdown, status: 'published', publishedAt: '2025-01-01' },
      { ...common, id: 'markdown-borrador', slug: 'markdown-borrador', title: 'Figura privada', content: 'Contenido privado de la figura\n\n```context-window\n```', status: 'draft' },
    ]);
  } finally { client.close(); }

  const response = await fetch(`${baseUrl}/articulo/markdown-publico`);
  const html = await response.text();
  assert.equal(response.status, 200);
  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
  assert.ok(main, 'article has a main landmark');
  assert.match(main, /<h2>Una explicación<\/h2>/);
  assert.match(main, /<strong>importante<\/strong>/);
  assert.match(main, /href="https:\/\/example\.com"/);
  assert.match(main, /<figure\b/);
  assert.match(main, /Simplificación educativa/);
  assert.match(main, />Avanzar<\/button>/);
  assert.match(main, />Reiniciar<\/button>/);
  assert.doesNotMatch(main, /<script\b|<img\b|onerror\s*=|href="\s*javascript:/i);

  const draft = await fetch(`${baseUrl}/articulo/markdown-borrador`);
  const draftHtml = await draft.text();
  assert.equal(draft.status, 404);
  assert.doesNotMatch(draftHtml, /Figura privada|Contenido privado de la figura/);
  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.doesNotMatch(await home.text(), /Figura privada|markdown-borrador/);
});

test('home keeps its introduction when the database is unavailable', async () => {
  const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
  server.kill();
  await stopped;
  const listener = createServer();
  const port = await new Promise<number>(resolve => listener.listen(0, '127.0.0.1', () => {
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    listener.close(() => resolve(address.port));
  }));
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    env: { ...process.env, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', SITE_URL: `http://127.0.0.1:${port}` }, stdio: 'ignore',
  });
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 100 && !response; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}`); } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(response);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Aprender explicando/);
    assert.match(html, /No se pudieron cargar los artículos/);
    assert.doesNotMatch(html, /Aún no hay artículos publicados/);
  } finally {
    if (child.exitCode === null) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited; }
  }
});
