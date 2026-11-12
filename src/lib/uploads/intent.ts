// Disconnected internal persistence. Callers must authorize and reconcile ambiguous errors.
import { and, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { media, posts, uploadIntents } from '../../db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { registerMediaInTransaction, validateMedia } from '../media/membership.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Input = { operationId: string; mediaId: string; postId: string; storagePath: string };
type State = 'prepared' | 'uploaded' | 'registered';
function validateId(id: string) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('Invalid operation');
}

export async function findIntent(db: LibSQLDatabase, operationId: string) {
  validateId(operationId);
  const [row] = await db.select().from(uploadIntents).where(eq(uploadIntents.operationId, operationId));
  return row ?? null;
}

export async function createIntent(db: LibSQLDatabase, input: Input) {
  validateId(input.operationId);
  validateMedia(input.postId, input.mediaId, input.storagePath);
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(uploadIntents).where(eq(uploadIntents.operationId, input.operationId));
    if (existing) {
      if (existing.mediaId !== input.mediaId || existing.postId !== input.postId || existing.storagePath !== input.storagePath) throw new Error('Conflicting operation');
      return existing;
    }
    const [draft] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, input.postId), eq(posts.status, 'draft')));
    if (!draft) throw new Error('Draft not found');
    const [created] = await tx.insert(uploadIntents).values({ ...input, state: 'prepared' }).returning();
    return created;
  });
}

export async function transitionIntent(db: LibSQLDatabase, operationId: string, from: State, to: State) {
  validateId(operationId);
  if (from !== 'prepared' || to !== 'uploaded') throw new Error('Invalid transition');
  const [updated] = await db.update(uploadIntents).set({ state: to }).where(and(eq(uploadIntents.operationId, operationId), eq(uploadIntents.state, from))).returning();
  if (!updated) throw new Error('Stale operation');
  return updated;
}

export async function registerIntent(db: LibSQLDatabase, operationId: string) {
  validateId(operationId);
  return db.transaction(async tx => {
    const [intent] = await tx.select().from(uploadIntents).where(eq(uploadIntents.operationId, operationId));
    if (!intent) throw new Error('Operation not found');
    if (intent.state === 'registered') {
      const [registered] = await tx.select().from(media).where(eq(media.id, intent.mediaId));
      if (!registered || registered.postId !== intent.postId || registered.storagePath !== intent.storagePath) throw new Error('Inconsistent registration');
      return intent;
    }
    if (intent.state !== 'uploaded') throw new Error('Stale operation');
    const [updated] = await tx.update(uploadIntents).set({ state: 'registered' }).where(and(eq(uploadIntents.operationId, operationId), eq(uploadIntents.state, 'uploaded'))).returning();
    if (!updated) throw new Error('Stale operation');
    await registerMediaInTransaction(tx, intent.postId, intent.mediaId, intent.storagePath);
    return updated;
  });
}
