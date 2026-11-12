'use client';

import { createElement as h, useState } from 'react';
import type { ArticleEditorValues } from '../../../components/editor/article-editor';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleEditor } from '../../../components/editor/article-editor.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { insertImageReference } from './image-reference.ts';

/** Presentation only: the guarded save and upload routes and the server
 * composition stay server-side. */
export interface EditorFormProps {
  initial: ArticleEditorValues;
  saveUrl: string;
  uploadUrl: string;
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
const noteClasses = 'font-mono text-xs text-[#a6b9ac]';

export function EditorForm({ initial, saveUrl, uploadUrl }: EditorFormProps) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<keyof typeof messages>('idle');
  const [uploadStatus, setUploadStatus] = useState<keyof typeof uploadMessages>('idle');
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const saving = status === 'saving';
  const uploading = uploadStatus === 'uploading';
  const save = async () => {
    setStatus('saving');
    try {
      // Browsers send the Origin header on POST, which the route compares against
      // the exact configured origin; any failure is a generic server answer.
      const response = await fetch(saveUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      setStatus(response.ok ? 'saved' : 'failed');
    } catch { setStatus('failed'); }
  };
  const upload = async () => {
    if (!file || uploading) return;
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
      h('div', { className: 'grid gap-3', 'aria-label': 'Imagenes del borrador' },
        h('input', {
          type: 'file',
          accept: 'image/jpeg,image/png,image/webp',
          'aria-label': 'Elegir imagen (JPEG, PNG o WebP)',
          className: noteClasses,
          onChange: event => { setFile(event.target.files?.[0] ?? null); setUploadStatus('idle'); },
        }),
        h('button', {
          type: 'button', onClick: () => void upload(), disabled: uploading,
          className: buttonClasses,
        }, 'Subir imagen'),
        h('p', { role: 'status', className: noteClasses }, uploadMessages[uploadStatus]),
        uploadedPath ? h('p', { className: noteClasses }, `Ruta de la imagen: ${uploadedPath}`) : null,
      ),
    ),
  );
}
