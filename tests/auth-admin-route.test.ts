import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

// Run only from a self-contained, parent-prepared copy with no private files, on a
// normal filesystem: Turbopack cannot start its node process pool from tmpfs.
const isolated = process.env.AUTH_HTTP_ISOLATED === '1';
const skip = isolated ? false : 'Requires AUTH_HTTP_ISOLATED=1 inside an isolated copy with node_modules';
const origin = 'https://blog.example.test';
const password = 'synthetic test password';
const salt = Buffer.alloc(16, 1);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const config: Record<string, string> = { AUTH_ORIGIN: origin, AUTH_USERNAME: 'admin', AUTH_PASSWORD_HASH: hash, AUTH_SESSION_SECRET: secret };
const draftTitle = 'Borrador privado de prueba';
const draftSlug = 'borrador-privado-de-prueba';

async function freePort(): Promise<number> {
  const listener = createServer();
  return new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('No TCP port'));
      listener.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}

async function withServer(run: (base: string) => Promise<void>) {
  assert.ok(isolated, 'Run only in a self-contained isolated copy with AUTH_HTTP_ISOLATED=1');
  const dir = await mkdtemp(join(tmpdir(), 'blog-admin-http-'));
  let child: ChildProcess | undefined;
  try {
    const databaseUrl = pathToFileURL(join(dir, 'fixture.sqlite')).href;
    const db = createClient({ url: databaseUrl });
    try {
      await db.executeMultiple(await readFile('drizzle/0000_initial.sql', 'utf8'));
      await db.executeMultiple(await readFile('drizzle/0001_auth_throttle.sql', 'utf8'));
      const now = new Date().toISOString();
      await db.execute({
        sql: `INSERT INTO posts (id, slug, title, excerpt, content, tags, cover_image, status, created_at, updated_at, published_at)
              VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, NULL)`,
        args: ['fixture-draft', draftSlug, draftTitle, 'Resumen del borrador.', '# Borrador\n\nSolo visible en el panel.', '["Pruebas"]', now, now],
      });
    } finally { db.close(); }
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port), '-H', '127.0.0.1'], {
      env: { PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), HOME: dir, NODE_ENV: 'development', TURSO_DATABASE_URL: databaseUrl, SITE_URL: base, ...config },
      stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated Next server exited');
      try { const response = await fetch(`${base}/login`); if (response.status === 200) { ready = true; break; } } catch { /* waiting for server */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'Isolated Next server did not become ready');
    await run(base);
  } finally {
    if (child) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
}

function login(base: string) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ username: 'admin', password }).toString(),
  });
}

function logout(base: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/logout`, { method: 'POST', redirect: 'manual', headers });
}

async function sessionCookie(base: string): Promise<string> {
  const response = await login(base);
  assert.equal(response.status, 303, 'login must succeed for the fixture client');
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0];
}

test('admin requires the session cookie and shows the private drafts list', { skip }, async () => {
  await withServer(async base => {
    const anonymous = await fetch(`${base}/admin`, { redirect: 'manual' });
    assert.equal(anonymous.status, 307);
    assert.equal(anonymous.headers.get('location'), '/login');
    assert.doesNotMatch(await anonymous.text(), new RegExp(draftTitle));

    for (const cookie of ['__Host-admin=forged', `${await sessionCookie(base)}x`, `__Host-admin=${encodeURIComponent('a b')}`]) {
      const rejected = await fetch(`${base}/admin`, { redirect: 'manual', headers: { cookie } });
      assert.equal(rejected.status, 307);
      assert.equal(rejected.headers.get('location'), '/login');
    }

    const cookie = await sessionCookie(base);
    const authorized = await fetch(`${base}/admin`, { headers: { cookie } });
    assert.equal(authorized.status, 200);
    const html = await authorized.text();
    assert.match(html, new RegExp(draftTitle));
    assert.match(html, /Borrador/);
    assert.match(html, /Pruebas/);
    assert.match(html, /Tu cuaderno\./);

    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.doesNotMatch(await home.text(), new RegExp(draftTitle));
  });
});

test('logout requires the exact origin and clears the protected cookie', { skip }, async () => {
  await withServer(async base => {
    const attempts: Record<string, string>[] = [{}, { origin: 'https://evil.example' }, { origin }];
    for (const headers of attempts) {
      const response = await logout(base, headers);
      if (headers.origin === origin) {
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('location'), '/login');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('set-cookie'), '__Host-admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
        assert.equal(await response.text(), '');
        continue;
      }
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('location'), null);
      assert.equal(await response.text(), 'Login failed');
    }
  });
});
