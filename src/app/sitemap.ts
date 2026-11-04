import type { MetadataRoute } from 'next';
import { getPublishedArticles } from '../lib/articles';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = process.env.SITE_URL;
  if (!origin) throw new Error('SITE_URL is required for sitemap');
  const articles = await getPublishedArticles();
  return [{ url: new URL('/', origin).href }, { url: new URL('/sobre-mi', origin).href }, ...articles.map(article => ({ url: new URL(`/articulo/${encodeURIComponent(article.slug)}`, origin).href, lastModified: article.updatedAt }))];
}
