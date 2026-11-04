import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublishedArticleBySlug } from '../../../lib/articles';
import { ContentRenderer } from '../../../components/content/content-renderer';
type Props = { params: Promise<{ slug: string }> };
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getPublishedArticleBySlug((await params).slug);
  return article ? { title: article.title, description: article.excerpt } : { title: 'Página no encontrada', robots: { index: false } };
}
export default async function ArticlePage({ params }: Props) {
  const article = await getPublishedArticleBySlug((await params).slug);
  if (!article) notFound();
  return <main id="contenido" className="reading"><article><div className="center"><p className="eyebrow">{article.tags.join(' / ')}</p><h1>{article.title}</h1><p className="lead">{article.excerpt}</p></div><hr /><div className="article-text"><ContentRenderer markdown={article.content} /></div></article><p><Link href="/#articulos">← Volver al cuaderno</Link></p></main>;
}
