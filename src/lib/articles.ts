import { and, desc, eq } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import { posts, type Article } from '../db/schema';

export { createDatabase } from '../db/client';
export type { Article } from '../db/schema';

export async function getPublishedArticles(): Promise<Article[]> {
  const { db, client } = createDatabase();
  try { return await db.select().from(posts).where(eq(posts.status, 'published')).orderBy(desc(posts.publishedAt)); }
  finally { client.close(); }
}

export async function getPublishedArticleBySlug(slug: string): Promise<Article | undefined> {
  const { db, client } = createDatabase();
  try { return (await db.select().from(posts).where(and(eq(posts.status, 'published'), eq(posts.slug, slug))).limit(1))[0]; }
  finally { client.close(); }
}
