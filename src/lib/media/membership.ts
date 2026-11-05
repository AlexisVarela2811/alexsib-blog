// Internal persistence only: callers must authorize every operation.
import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { media, posts, publishedMedia } from '../../db/schema.ts';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function registerMedia(db: LibSQLDatabase, postId: string, id: string, storagePath: string) {
  if (!idPattern.test(id) || typeof postId !== 'string' || !postId || typeof storagePath !== 'string' || !storagePath || storagePath.length > 2048) throw new Error('Invalid media');
  return db.transaction(async tx => {
    const [draft] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.status, 'draft')));
    if (!draft) throw new Error('Draft not found');
    const [created] = await tx.insert(media).values({ id, postId, storagePath }).returning();
    return created;
  });
}

export async function findPublicMedia(db: LibSQLDatabase, id: string) {
  if (typeof id !== 'string' || !idPattern.test(id)) return null;
  const [found] = await db.select({ id: media.id, storagePath: media.storagePath }).from(media)
    .innerJoin(publishedMedia, and(eq(publishedMedia.mediaId, media.id), eq(publishedMedia.postId, media.postId)))
    .innerJoin(posts, and(eq(posts.id, media.postId), eq(posts.status, 'published')))
    .where(eq(media.id, id));
  return found ?? null;
}
