import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createDatabase } from '../../db/client';
import { createAuthComposition } from '../../lib/auth/composition';
import { listDrafts } from '../../lib/drafts';

export const metadata: Metadata = { title: 'Panel privado', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Draft = { id: string; title: string; tags: string[] };

function authConfig() {
  return {
    origin: process.env.AUTH_ORIGIN,
    username: process.env.AUTH_USERNAME,
    passwordHash: process.env.AUTH_PASSWORD_HASH,
    sessionSecret: process.env.AUTH_SESSION_SECRET,
  };
}

export default async function AdminPage() {
  const cookie = (await headers()).get('cookie') ?? '';
  let authorized = false;
  let drafts: Draft[] | null = null;
  try {
    const { db, client } = createDatabase();
    try {
      authorized = await createAuthComposition(authConfig(), client).authorizeRead(cookie) === true;
      if (authorized) drafts = await listDrafts(db);
    } finally { client.close(); }
  } catch { authorized = false; }
  // Unauthorized readers must not learn whether the panel or the database exists.
  if (!authorized) redirect('/login');

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
      <section aria-label="Borradores">
        {drafts === null ? <p>No se pudieron cargar los borradores. Probá de nuevo en unos minutos.</p>
          : drafts.length === 0 ? <p>Todavía no hay borradores.</p>
            : drafts.map(draft => (
              <div className="row" key={draft.id}>
                <div>
                  <h2>{draft.title}</h2>
                  {draft.tags.length > 0 ? <span className="meta">{draft.tags.join(' · ')}</span> : null}
                </div>
                <Link className="badge" href={`/admin/${encodeURIComponent(draft.id)}`}>Editar</Link>
              </div>
            ))}
      </section>
    </main>
  );
}
