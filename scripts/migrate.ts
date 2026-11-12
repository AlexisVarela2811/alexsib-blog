import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { existingObjectsQuery } from './migration-guard.ts';

const url = process.env.TURSO_DATABASE_URL;
const args = process.argv.slice(2);
const remote = args.length === 1 && args[0] === '--remote';
if (args.length && !remote) throw new Error('Unknown migration option');
if (!remote && (!url || !url.startsWith('file:'))) throw new Error('Migration requires an explicit local file: TURSO_DATABASE_URL');
if (remote) {
  let parsed: URL;
  try { parsed = new URL(url ?? ''); } catch { throw new Error('Remote migration requires a valid libsql URL'); }
  if (parsed.protocol !== 'libsql:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Remote migration requires a secure libsql URL without credentials or options');
  }
  if (!process.env.TURSO_AUTH_TOKEN?.trim()) throw new Error('Remote migration requires TURSO_AUTH_TOKEN');
}
const client = createClient({ url: url!, ...(remote ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}) });
try {
  const tx = await client.transaction('write');
  try {
    if (remote) {
      const existing = await tx.execute(existingObjectsQuery);
      if (existing.rows.length) throw new Error('Remote migration requires an empty database');
    }
    for (const file of ['0000_initial.sql', '0001_auth_throttle.sql', '0002_media.sql', '0003_upload_intent.sql']) {
      const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await tx.execute(statement);
    }
    const conflicts = await tx.execute(`SELECT 1 FROM upload_intents i LEFT JOIN media m ON m.id = i.media_id OR m.storage_path = i.storage_path
      WHERE (m.id IS NOT NULL AND NOT (i.state = 'registered' AND m.id = i.media_id AND m.post_id = i.post_id AND m.storage_path = i.storage_path))
         OR (i.state = 'registered' AND m.id IS NULL) LIMIT 1`);
    if (conflicts.rows.length) throw new Error('Conflicting upload reservations require reconciliation');
    const migration = await readFile(new URL('../drizzle/0004_upload_reservations.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('-- statement-breakpoint')) await tx.execute(statement);
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch { console.error('Migration rollback could not be confirmed'); }
    throw error;
  }
  console.log('Migration completed');
} catch (error) {
  if (remote) throw new Error('Remote migration failed; inspect the database before retrying');
  throw error;
} finally { client.close(); }
