import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasPrivateSession } from '../editorial-session';
import { EditorForm } from '../[id]/editor-form';

export const metadata: Metadata = { title: 'Nuevo artículo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const empty = { title: '', slug: '', excerpt: '', tags: '', markdown: '' };

export default async function NewArticlePage() {
  const cookie = (await headers()).get('cookie') ?? '';
  // Fail closed: without a verifiable session the page answers exactly like the panel.
  if (!await hasPrivateSession(cookie)) redirect('/login');
  return (
    <main id="contenido">
      <p className="eyebrow">~/panel/editor · NUEVO</p>
      <div className="topline">
        <div>
          <h1>Nuevo artículo</h1>
          <p>Se crea como borrador. Nada se publica desde acá.</p>
        </div>
        <nav aria-label="Volver al panel">
          <Link href="/admin">← Volver al panel</Link>
        </nav>
      </div>
      <p className="hint">
        Completá título, resumen, etiquetas y texto, y guardá para crear el borrador. Si dejás el slug vacío se
        arma solo desde el título. Las imágenes se suben después, ya con el borrador creado.
      </p>
      <EditorForm initial={empty} saveUrl="/api/admin/drafts" />
    </main>
  );
}
