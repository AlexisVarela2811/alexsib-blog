'use client';

import { createElement as h, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ArticleEditorValues } from '../../../components/editor/article-editor';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleEditor } from '../../../components/editor/article-editor.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { insertImageReference } from './image-reference.ts';

/** Presentation only: the guarded save and upload routes and the server
 * composition stay server-side. `cover` is the stored cover of the draft — a
 * blog-managed /media/<uuid> path, a legacy external URL, or null when there is
 * none. A legacy external URL is shown as text only: the editor never fetches
 * an external image, and publishing rejects such a cover until it is removed. */
export interface EditorFormProps {
  initial: ArticleEditorValues;
  cover?: string | null;
  saveUrl: string;
  /** Optional: a draft that does not exist yet has nothing to upload into, so the
   * create page omits the upload block entirely. */
  uploadUrl?: string;
}

const messages = {
  idle: 'Los cambios están solo en esta pantalla hasta que guardes.',
  saving: 'Guardando…',
  saved: 'Cambios guardados.',
  failed: 'No se pudieron guardar los cambios. Probá de nuevo en unos minutos.',
} as const;

const uploadMessages = {
  idle: 'Elegí una imagen (JPEG, PNG o WebP) y subila para insertarla en el texto.',
  uploading: 'Subiendo imagen…',
  uploaded: 'Imagen subida. Queda privada hasta que publiques el artículo.',
  failed: 'No se pudo subir la imagen. Probá de nuevo en unos minutos.',
} as const;

const buttonClasses = 'cursor-pointer justify-self-start rounded border border-[#a1efb5] bg-[#a1efb5] px-4 py-3 font-mono text-xs text-[#0b100d] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a1efb5] disabled:cursor-default disabled:opacity-55';
const noteClasses = 'break-words font-mono text-xs text-[#a6b9ac]';

export function EditorForm({ initial, cover, saveUrl, uploadUrl }: EditorFormProps) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<keyof typeof messages>('idle');
  const [uploadStatus, setUploadStatus] = useState<keyof typeof uploadMessages>('idle');
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const saving = status === 'saving';
  const uploading = uploadStatus === 'uploading';
  const save = async () => {
    setStatus('saving');
    try {
      // Browsers send the Origin header on POST, which the route compares against
      // the exact configured origin; any failure is a generic server answer.
      // Without an explicit removal the cover key is simply absent, so the
      // stored cover — including a legacy external one — is preserved unless the
      // admin asked to remove it.
      const payload = coverRemoved ? { ...values, cover: null } : values;
      const response = await fetch(saveUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      // The create route answers the new draft id; the edit route answers no id.
      // Only a same-origin panel path built from that id is ever navigated to.
      const data = response.ok ? await response.json().catch(() => null) : null;
      const createdId = data && typeof data === 'object' && typeof (data as { id?: unknown }).id === 'string'
        ? (data as { id: string }).id
        : null;
      if (createdId) { router.push(`/admin/${encodeURIComponent(createdId)}`); return; }
      setStatus(response.ok ? 'saved' : 'failed');
    } catch { setStatus('failed'); }
  };
  const upload = async () => {
    if (!file || uploading || !uploadUrl) return;
    setUploadStatus('uploading');
    try {
      // The guarded upload route requires the session cookie and the exact
      // configured origin, checks the declared image type, enforces the upload
      // byte limit and validates the signature; every failure is generic.
      const response = await fetch(uploadUrl, {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file,
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      const path = data && typeof data === 'object' && typeof (data as { path?: unknown }).path === 'string'
        ? (data as { path: string }).path
        : null;
      let reference: string;
      try {
        // Only a /media/<uuid> path from our own route is ever inserted.
        if (!path) throw new Error('Invalid upload answer');
        reference = insertImageReference(values.markdown, path);
      } catch { setUploadStatus('failed'); return; }
      setUploadedPath(path);
      onChange({ ...values, markdown: reference });
      setUploadStatus('uploaded');
    } catch { setUploadStatus('failed'); }
  };
  const onChange = (next: ArticleEditorValues) => {
    setValues(next);
    setStatus('idle');
  };
  return h('section', { 'aria-label': 'Editor del borrador' },
    h('div', { className: 'grid gap-8' },
      h(ArticleEditor, { values, onChange }),
      h('div', { className: 'grid gap-3' },
        h('button', {
          type: 'button', onClick: () => void save(), disabled: saving,
          className: buttonClasses,
        }, 'Guardar cambios'),
        h('p', { role: 'status', className: noteClasses }, messages[status]),
        h('p', { className: noteClasses }, 'La vista previa muestra la última versión guardada.'),
      ),
      h('div', { role: 'group', 'aria-label': 'Imágenes del borrador', className: 'side-block' },
        h('h2', null, '// imágenes'),
        !uploadUrl ? h('p', { className: noteClasses }, 'Guardá el borrador para poder subir imágenes.') : null,
        h('input', {
          type: 'file',
          accept: 'image/jpeg,image/png,image/webp',
          'aria-label': 'Elegir imagen (JPEG, PNG o WebP)',
          className: noteClasses,
          onChange: event => { setFile(event.target.files?.[0] ?? null); setUploadStatus('idle'); },
        }),
        h('button', {
          type: 'button', onClick: () => void upload(), disabled: uploading || !uploadUrl,
          className: buttonClasses,
        }, 'Subir imagen'),
        h('p', { role: 'status', className: noteClasses }, uploadMessages[uploadStatus]),
        uploadedPath ? h('p', { className: noteClasses }, `Ruta de la imagen: ${uploadedPath}`) : null,
      ),
      cover !== undefined && cover !== null ? h('div', { role: 'group', 'aria-label': 'Portada del borrador', className: 'side-block' },
        h('h2', null, '// portada'),
        cover.startsWith('/media/')
          ? h('img', { src: cover, alt: 'Portada actual del borrador', className: 'max-w-xs rounded border border-[#304537] bg-[#111a15]' })
          : h('p', { className: noteClasses }, 'Portada externa: hay que quitarla antes de poder publicar.'),
        h('p', { className: noteClasses }, `Portada actual: ${cover}`),
        coverRemoved
          ? h('button', { type: 'button', onClick: () => setCoverRemoved(false), className: buttonClasses }, 'Conservar portada')
          : h('button', { type: 'button', onClick: () => setCoverRemoved(true), className: buttonClasses }, 'Quitar portada'),
        coverRemoved ? h('p', { role: 'status', className: noteClasses }, 'La portada se quitará al guardar los cambios.') : null,
      ) : null,
    ),
  );
}
