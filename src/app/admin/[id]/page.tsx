import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { loadEditorDraft } from '../editorial-session';
import { EditorForm } from './editor-form';

export const metadata: Metadata = { title: 'Editor privado', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookie = (await headers()).get('cookie') ?? '';
  const outcome = await loadEditorDraft(cookie, id);
  // Fail closed: without a verifiable session the page answers exactly like the panel.
  if (outcome.unauthorized) redirect('/login');
  if (!outcome.values) notFound();
  const target = `/admin/${encodeURIComponent(id)}`;
  return (
    <main id="contenido" className="private-main">
      <p className="eyebrow">~/panel/editor · BORRADOR</p>
      <div className="topline">
        <div>
          <h1>{outcome.values.title}</h1>
          <p>Título, resumen, etiquetas y texto. Nada se publica desde acá.</p>
        </div>
        <nav aria-label="Editar o previsualizar el borrador">
          <Link href={`${target}/vista`}>Vista previa ↗</Link>
          <Link href="/admin">← Volver al panel</Link>
        </nav>
      </div>
      <p className="hint">Guardá antes de ir a la vista previa: solo se muestra la última versión guardada.</p>
      <EditorForm
        initial={outcome.values}
        cover={outcome.cover}
        saveUrl={`/api/admin/drafts/${encodeURIComponent(id)}`}
        uploadUrl={`/api/admin/drafts/${encodeURIComponent(id)}/upload`}
      />
    </main>
  );
}
