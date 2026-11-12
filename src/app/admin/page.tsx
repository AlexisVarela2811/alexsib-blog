import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { loadPanelArticles } from './editorial-session.ts';

export const metadata: Metadata = { title: 'Panel privado', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const cookie = (await headers()).get('cookie') ?? '';
  const panel = await loadPanelArticles(cookie);
  // Unauthorized readers must not learn whether the panel or the database exists.
  if (panel.unauthorized) redirect('/login');

  return (
    <main id="contenido">
      <p className="eyebrow">~/panel/artículos</p>
      <div className="topline">
        <div>
          <h1>Tu cuaderno.</h1>
          <p>Ideas que estás trabajando y otras que ya compartiste.</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit">Salir</button>
        </form>
      </div>
      {panel.drafts === null || panel.published === null ? <p>No se pudieron cargar los artículos. Probá de nuevo en unos minutos.</p> : (
        <>
          <section aria-label="Borradores">
            {panel.drafts.length === 0 ? <p>Todavía no hay borradores.</p>
              : panel.drafts.map(draft => (
                <div className="row" key={draft.id}>
                  <div>
                    <h2>{draft.title}</h2>
                    {draft.tags.length > 0 ? <span className="meta">{draft.tags.join(' · ')}</span> : null}
                    {/* A legacy external cover can never publish: mark it so the
                        admin knows to remove it in the editor first [S2]. */}
                    {draft.legacyCover ? <span className="meta">Portada externa: hay que quitarla antes de poder publicar.</span> : null}
                  </div>
                  <div>
                    {/* Publish works from a plain form: the route guards the
                        session and the exact origin and answers 303 back here. */}
                    <form action={`/api/admin/drafts/${encodeURIComponent(draft.id)}/publish`} method="post">
                      <button type="submit">Publicar</button>
                    </form>
                    {/* Drafts are only edited while unpublished, so the edit
                        link exists only in this list. */}
                    <Link className="badge" href={`/admin/${encodeURIComponent(draft.id)}`}>Editar</Link>
                  </div>
                </div>
              ))}
          </section>
          <section aria-label="Publicados">
            {panel.published.length === 0 ? <p>Nada publicado todavía.</p>
              : panel.published.map(article => (
                <div className="row" key={article.id}>
                  <div>
                    <h2>{article.title}</h2>
                    {article.tags.length > 0 ? <span className="meta">{article.tags.join(' · ')}</span> : null}
                  </div>
                  <div>
                    <form action={`/api/admin/drafts/${encodeURIComponent(article.id)}/unpublish`} method="post">
                      <button type="submit">Despublicar</button>
                    </form>
                  </div>
                </div>
              ))}
          </section>
        </>
      )}
    </main>
  );
}
