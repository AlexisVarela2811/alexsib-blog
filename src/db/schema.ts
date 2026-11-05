import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  content: text('content').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  coverImage: text('cover_image'),
  status: text('status', { enum: ['draft', 'published'] }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  publishedAt: text('published_at'),
});
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id),
  storagePath: text('storage_path').notNull().unique(),
});
export const publishedMedia = sqliteTable('published_media', {
  postId: text('post_id').notNull().references(() => posts.id),
  mediaId: text('media_id').notNull().references(() => media.id),
}, table => [primaryKey({ columns: [table.postId, table.mediaId] })]);
export type Article = typeof posts.$inferSelect;
