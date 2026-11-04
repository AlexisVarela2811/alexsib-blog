import type { Client } from '@libsql/client';

// One global budget protects the single admin even when an attacker changes IPs or usernames.
// Call before every credential verification, including attempts that would otherwise be invalid.
// A database error, missing migration, or ambiguous result must never authorize an attempt.
export async function consumeLoginAttempt(client: Client): Promise<boolean> {
  try {
    const result = await client.execute(`
      UPDATE login_throttle
      SET attempts = CASE WHEN unixepoch() >= window_start + 900 THEN 1 ELSE attempts + 1 END,
          window_start = CASE WHEN unixepoch() >= window_start + 900 THEN unixepoch() ELSE window_start END
      WHERE id = 1 AND (unixepoch() >= window_start + 900 OR attempts < 5)
      RETURNING id
    `);
    return result.rows.length === 1 && result.rows[0].id === 1;
  } catch {
    return false;
  }
}
