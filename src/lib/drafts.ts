// Server-side persistence only. This module does not authenticate or authorize:
// every caller must enforce authorization before reading or mutating drafts.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { media, posts, publishedMedia } from '../db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { extractMediaReferences } from './media/references.ts';

type Database = LibSQLDatabase;
type DraftInput = { slug: string; title: string; excerpt: string; content: string; tags: string[]; coverImage: string | null };

function validate(input: unknown): DraftInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid draft');
  const value = input as Record<string, unknown>;
  const keys = ['slug', 'title', 'excerpt', 'content', 'tags', 'coverImage'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid draft');
  const text = (field: string, max: number): string => {
    const v = value[field];
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${field}`);
    return v;
  };
  const slug = text('slug', 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid slug');
  const title = text('title', 200);
  const excerpt = text('excerpt', 500);
  const content = text('content', 200000);
  if (!Array.isArray(value.tags) || value.tags.length > 20 || value.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 50)) throw new Error('Invalid tags');
  const coverImage = value.coverImage;
  if (coverImage !== null) {
    if (typeof coverImage !== 'string' || coverImage.length > 2048) throw new Error('Invalid coverImage');
    if (!/^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(coverImage)) throw new Error('Invalid coverImage');
  }
  extractMediaReferences(content, coverImage);
  return { slug, title, excerpt, content, tags: value.tags, coverImage };
}

function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Invalid id');
}

export async function listDrafts(db: Database) {
  return db.select().from(posts).where(eq(posts.status, 'draft')).orderBy(desc(posts.updatedAt));
}

export async function createDraft(db: Database, input: unknown) {
  const data = validate(input);
  const now = new Date().toISOString();
  const [created] = await db.insert(posts).values({ ...data, id: randomUUID(), status: 'draft', createdAt: now, updatedAt: now, publishedAt: null }).returning();
  return created;
}

export async function editDraft(db: Database, id: unknown, input: unknown) {
  validateId(id);
  const data = validate(input);
  const [updated] = await db.update(posts).set({ ...data, updatedAt: new Date().toISOString() }).where(and(eq(posts.id, id), eq(posts.status, 'draft'))).returning();
  if (!updated) throw new Error('Draft not found');
  return updated;
}

export async function publishDraft(db: Database, id: unknown) {
  validateId(id);
  return db.transaction(async tx => {
    const [draft] = await tx.select().from(posts).where(and(eq(posts.id, id), eq(posts.status, 'draft')));
    if (!draft) throw new Error('Draft not found');
    const references = extractMediaReferences(draft.content, draft.coverImage);
    if (references.length) {
      const owned = await tx.select({ id: media.id }).from(media).where(and(eq(media.postId, id), inArray(media.id, references)));
      if (owned.length !== references.length) throw new Error('Media not owned by draft');
    }
    await tx.delete(publishedMedia).where(eq(publishedMedia.postId, id));
    if (references.length) await tx.insert(publishedMedia).values(references.map(mediaId => ({ postId: id, mediaId })));
    const now = new Date().toISOString();
    const [updated] = await tx.update(posts).set({ status: 'published', publishedAt: now, updatedAt: now }).where(and(eq(posts.id, id), eq(posts.status, 'draft'))).returning();
    if (!updated) throw new Error('Draft not found');
    return updated;
  });
}

export async function unpublishDraft(db: Database, id: unknown) {
  validateId(id);
  return db.transaction(async tx => {
    const [updated] = await tx.update(posts).set({ status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() }).where(and(eq(posts.id, id), eq(posts.status, 'published'))).returning();
    if (!updated) throw new Error('Published article not found');
    await tx.delete(publishedMedia).where(eq(publishedMedia.postId, id));
    return updated;
  });
}
