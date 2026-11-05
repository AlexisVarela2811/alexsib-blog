import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';

const url = process.env.TURSO_DATABASE_URL;
if (!url || !url.startsWith('file:')) throw new Error('Migration requires an explicit local file: TURSO_DATABASE_URL');
const client = createClient({ url });
try {
  await client.executeMultiple(await readFile(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
  await client.executeMultiple(await readFile(new URL('../drizzle/0001_auth_throttle.sql', import.meta.url), 'utf8'));
  await client.executeMultiple(await readFile(new URL('../drizzle/0002_media.sql', import.meta.url), 'utf8'));
  console.log('Migration completed');
} finally { client.close(); }
