// Disconnected server-side boundary. Never construct dependencies from request
// data: the trusted caller must validate a session for reads and both session
// and request origin for mutations. This module does not enable any route.
import { desc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { posts, type Article } from '../../db/schema.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDraft, editDraft, publishDraft, unpublishDraft } from '../drafts.ts';

type Persistence = {
  list: () => Promise<Article[]>;
  read: (id: string) => Promise<Article | undefined>;
  create: (input: unknown) => Promise<Article>;
  edit: (id: string, input: unknown) => Promise<Article>;
  publish: (id: string) => Promise<Article>;
  unpublish: (id: string) => Promise<Article>;
};

type Dependencies = {
  /** Must validate the current session, not merely the presence of a cookie. */
  authorizeRead: () => Promise<boolean>;
  /** Must validate both the current session and the request origin. */
  authorizeMutation: () => Promise<boolean>;
  persistence: Persistence;
};

/** Construct only in trusted server code; all access must go through the service. */
export function createEditorialPersistence(db: LibSQLDatabase): Persistence {
  return {
    list: () => db.select().from(posts).orderBy(desc(posts.updatedAt)),
    read: async id => (await db.select().from(posts).where(eq(posts.id, id)).limit(1))[0],
    create: input => createDraft(db, input),
    edit: (id, input) => editDraft(db, id, input),
    publish: id => publishDraft(db, id),
    unpublish: id => unpublishDraft(db, id),
  };
}

export function createEditorialService(deps: Dependencies) {
  async function run<T>(authorize: () => Promise<boolean>, action: () => Promise<T>): Promise<T> {
    let allowed = false;
    try { allowed = await authorize() === true; } catch { /* fail closed */ }
    if (!allowed) throw new Error('Unauthorized');
    try { return await action(); } catch { throw new Error('Editorial operation failed'); }
  }
  return {
    list: () => run(() => deps.authorizeRead(), () => deps.persistence.list()),
    read: (id: string) => run(() => deps.authorizeRead(), () => deps.persistence.read(id)),
    create: (input: unknown) => run(() => deps.authorizeMutation(), () => deps.persistence.create(input)),
    edit: (id: string, input: unknown) => run(() => deps.authorizeMutation(), () => deps.persistence.edit(id, input)),
    publish: (id: string) => run(() => deps.authorizeMutation(), () => deps.persistence.publish(id)),
    unpublish: (id: string) => run(() => deps.authorizeMutation(), () => deps.persistence.unpublish(id)),
  };
}
