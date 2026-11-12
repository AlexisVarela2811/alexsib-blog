import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ContentRenderer } from '../../../../components/content/content-renderer';
import { loadPreviewDraft } from '../../editorial-session';

export const metadata: Metadata = { title: 'Vista previa privada', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookie = (await headers()).get('cookie') ?? '';
  const outcome = await loadPreviewDraft(cookie, id);
  // Fail closed: without a verifiable session this page answers exactly like the panel.
  if (outcome.unauthorized) redirect('/login');
  if (!outcome.draft) notFound();
  const draft = outcome.draft;
  return (
    <main id="contenido">
      <div className="topline">
        <p role="note">
          <span className="badge">Borrador</span>{' '}
          Vista previa privada: así se lee sin publicarlo. Solo es visible desde el panel con tu sesión.
        </p>
        <Link href={`/admin/${encodeURIComponent(id)}`}>← Volver al editor</Link>
      </div>
      <article className="reading">
        <div className="center">
          <p className="eyebrow">{draft.tags.join(' / ')}</p>
          <h1>{draft.title}</h1>
          <p className="lead">{draft.excerpt}</p>
        </div>
        <hr />
        <div className="article-text"><ContentRenderer markdown={draft.content} /></div>
      </article>
    </main>
  );
}
