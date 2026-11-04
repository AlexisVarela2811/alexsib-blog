import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

export function createDatabase(url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN) {
  if (!url) throw new Error('TURSO_DATABASE_URL is required');
  if (!url.startsWith('file:') && !authToken) throw new Error('TURSO_AUTH_TOKEN is required for remote databases');
  const client = createClient({ url, authToken: authToken || undefined });
  return { db: drizzle(client), client };
}
