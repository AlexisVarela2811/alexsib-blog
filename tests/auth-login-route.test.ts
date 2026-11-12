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

// Run only from a self-contained, parent-prepared copy with no private files.
// The explicit opt-in avoids accidentally starting Next in the original workspace.
const isolated = process.env.AUTH_HTTP_ISOLATED === '1';
// The default suite must stay green without spawning Next: opt in explicitly.
const skip = isolated ? false : 'Requires AUTH_HTTP_ISOLATED=1 inside an isolated copy with node_modules';
const origin = 'https://blog.example.test';
const password = 'synthetic test password';
const salt = Buffer.alloc(16, 1);
const hash = `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')}`;
const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');
const baseConfig: Record<string, string> = {
  AUTH_ORIGIN: origin,
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD_HASH: hash,
  AUTH_SESSION_SECRET: secret,
};

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

async function withServer(config: Record<string, string>, migrated: boolean, run: (base: string) => Promise<void>) {
  assert.ok(isolated, 'Run only in a self-contained isolated copy with AUTH_HTTP_ISOLATED=1');
  const dir = await mkdtemp(join(tmpdir(), 'blog-login-http-'));
  let child: ChildProcess | undefined;
  try {
    const databaseUrl = pathToFileURL(join(dir, 'fixture.sqlite')).href;
    const db = createClient({ url: databaseUrl });
    try {
      await db.executeMultiple(await readFile('drizzle/0000_initial.sql', 'utf8'));
      if (migrated) await db.executeMultiple(await readFile('drizzle/0001_auth_throttle.sql', 'utf8'));
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

function login(base: string, body: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/login?next=https://evil.example`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body,
  });
}

async function failure(response: Response) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), 'Login failed');
}

const goodBody = new URLSearchParams({ username: 'admin', password }).toString();

test('public form posts to login, failures stay generic, success sets the protected cookie and home remains public', { skip }, async () => {
  await withServer(baseConfig, true, async base => {
    const page = await fetch(`${base}/login`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<form\b[^>]*\baction="\/api\/auth\/login"[^>]*\bmethod="post"|<form\b[^>]*\bmethod="post"[^>]*\baction="\/api\/auth\/login"/i);
    assert.match(html, /name="username"/);
    assert.match(html, /name="password"/);
    assert.doesNotMatch(html, /<input\b[^>]*\bdisabled|<button\b[^>]*\bdisabled/i);
    assert.doesNotMatch(html, /El acceso todavía no está disponible/);
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Aprender explicando/);
    await failure(await login(base, goodBody));
    await failure(await login(base, goodBody, { origin: 'https://evil.example', 'x-forwarded-host': 'blog.example.test' }));
    await failure(await login(base, 'username=admin&password=wrong', { origin }));
    const response = await login(base, goodBody, { origin });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('set-cookie') ?? '', /^__Host-admin=[A-Za-z0-9._-]+; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict$/);
    assert.equal(await response.text(), '');
  });
});

test('missing and malformed configuration fail closed without cookies or internal errors', { skip }, async () => {
  for (const config of [{}, { ...baseConfig, AUTH_ORIGIN: 'https://blog.example.test/path' }, { ...baseConfig, AUTH_SESSION_SECRET: 'invalid' }]) {
    await withServer(config, true, async base => failure(await login(base, goodBody, { origin })));
  }
});

test('a missing throttle table fails closed without cookies or internal errors', { skip }, async () => {
  await withServer(baseConfig, false, async base => failure(await login(base, goodBody, { origin })));
});
