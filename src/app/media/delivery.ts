// Server-side delivery for GET /media/<id>, built per request from explicit
// configuration values like the private editorial session. Two disjoint paths:
// published membership serves bytes without authentication and may be shared-
// cached for a short bounded time; every other byte transfer needs a verified
// `__Host-admin` session and is never stored by any cache. Everything else —
// unknown id, malformed id, draft without a session, storage failure, missing
// configuration — is the same empty 404. No storage path, bucket, token or
// internal error detail ever reaches the response.
import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDatabase } from '../../db/client.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { media, posts } from '../../db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAuthComposition } from '../../lib/auth/composition.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { findPublicMedia } from '../../lib/media/membership.ts';

const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
// Only the content types already accepted by the upload validation may be
// emitted; anything else is treated like a missing blob: empty 404.
const allowedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The media ids are UUIDs; the segment is untrusted, so both the exact shape
// and the length are bounded before any database or storage access.
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxIdLength = 36;
// Bounded revocation freshness: after unpublish, shared caches may keep serving
// a formerly public image for at most this long ("Volver a privadas").
const publishedCacheSeconds = 60;

type GetResult = {
  statusCode: 200;
  stream: ReadableStream<Uint8Array>;
  blob: { contentType: string };
} | { statusCode: 304 } | null;

export type BlobGetter = (pathname: string, options: { access: 'private'; token: string }) => Promise<GetResult>;

export type MediaDeliveryDependencies = {
  databaseUrl?: string;
  authToken?: string;
  token?: string;
  origin?: string;
  username?: string;
  passwordHash?: string;
  sessionSecret?: string;
  blobGet: BlobGetter;
};

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= maxIdLength && idPattern.test(id);
}

/** Draft-owned media only: the post must still be a draft. A published post's
 * media is reachable exclusively through published membership, so unpublish
 * ("Volver a privadas") is what re-enables session delivery. */
async function findDraftMedia(db: LibSQLDatabase, id: string): Promise<string | null> {
  const [row] = await db.select({ storagePath: media.storagePath })
    .from(media)
    .innerJoin(posts, and(eq(posts.id, media.postId), eq(posts.status, 'draft')))
    .where(eq(media.id, id));
  return row?.storagePath ?? null;
}

async function fetchImage(deps: MediaDeliveryDependencies, storagePath: string, cacheControl: string): Promise<Response> {
  // Fail closed before touching the provider when the token is missing.
  if (typeof deps.token !== 'string' || !deps.token.trim()) return notFound();
  let result: GetResult;
  try {
    result = await deps.blobGet(storagePath, { access: 'private', token: deps.token });
  } catch { return notFound(); }
  if (!result || result.statusCode !== 200 || !result.stream) return notFound();
  if (!allowedContentTypes.has(result.blob?.contentType ?? '')) {
    void result.stream.cancel().catch(() => {});
    return notFound();
  }
  return new Response(result.stream, {
    status: 200,
    headers: {
      'Content-Type': result.blob.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControl,
    },
  });
}

/** Serve one /media/<id> request. `cookie` is the raw Cookie header. */
export async function serveMedia(deps: MediaDeliveryDependencies, id: unknown, cookie: unknown): Promise<Response> {
  if (!validId(id)) return notFound();
  let client: ReturnType<typeof createDatabase>['client'];
  let db: ReturnType<typeof createDatabase>['db'];
  try {
    ({ db, client } = createDatabase(deps.databaseUrl, deps.authToken));
  } catch { return notFound(); }
  try {
    // 1. Published membership is the only unauthenticated path.
    const published = await findPublicMedia(db, id);
    if (published) return await fetchImage(deps, published.storagePath, `public, max-age=${publishedCacheSeconds}`);
    // 2. Draft delivery requires a verified `__Host-admin` session first.
    try {
      const auth = createAuthComposition(
        { origin: deps.origin, username: deps.username, passwordHash: deps.passwordHash, sessionSecret: deps.sessionSecret },
        client,
      );
      if (await auth.authorizeRead(cookie) !== true) return notFound();
    } catch { return notFound(); }
    const storagePath = await findDraftMedia(db, id);
    if (!storagePath) return notFound();
    return await fetchImage(deps, storagePath, 'private, no-store');
  } catch { return notFound(); }
  finally { client.close(); }
}
