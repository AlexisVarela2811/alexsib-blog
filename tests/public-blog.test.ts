import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('initial migration creates an isolated database and is repeatable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alexsib-migration-'));
  try {
    const env = { ...process.env, TURSO_DATABASE_URL: pathToFileURL(join(dir, 'test.sqlite')).href, TURSO_AUTH_TOKEN: '' };
    const run = () => execFileSync('npm', ['run', 'db:migrate'], { env, encoding: 'utf8', stdio: 'pipe' });
    assert.match(run(), /migrat/i);
    assert.match(run(), /migrat/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
