import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const clientModule = '../src/db/client.ts';
const schemaModule = '../src/db/schema.ts';
const { createDatabase } = await import(clientModule) as typeof import('../src/db/client');
const { posts } = await import(schemaModule) as typeof import('../src/db/schema');

const dir = process.env.BROWSER_FIXTURE_DIR;
if (!dir) throw new Error('BROWSER_FIXTURE_DIR is required');
mkdirSync(dir, { recursive: false });
const url = pathToFileURL(join(dir, 'fixture.sqlite')).href;
const env = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '', SITE_URL: 'http://127.0.0.1:3197' };
let server: ReturnType<typeof spawn> | undefined;
let shuttingDown = false;
// Playwright signals the whole process group, including Next and migration.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { shuttingDown = true; });
try {
  const migration = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/migrate.ts'], { env, stdio: 'inherit' });
  if (migration.status !== 0) throw new Error('Fixture migration failed');
  const { db, client } = createDatabase(url, '');
  try {
    const common = { excerpt: 'Una explicación para empezar con inteligencia artificial.', content: 'Un modelo de lenguaje predice cómo puede continuar un texto.\n\nUn token es un fragmento de texto, como una palabra o parte de ella.', tags: ['IA'], createdAt: '2025-01-01', updatedAt: '2025-01-01' };
    await db.insert(posts).values([
      { ...common, content: `${common.content}\n\n\`\`\`context-window\n\`\`\``, id: 'published', slug: 'modelo-de-lenguaje', title: '¿Qué es un modelo de lenguaje?', status: 'published', publishedAt: '2025-01-01' },
      { ...common, id: 'draft', slug: 'borrador-privado', title: 'Borrador privado de prueba', status: 'draft' },
    ]);
  } finally { client.close(); }
  if (shuttingDown) throw new Error('Fixture setup interrupted');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', '3197'], { env, stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve, reject) => {
    server!.once('error', reject);
    server!.once('exit', resolve);
  });
  if (code && code !== 0) process.exitCode = code;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
