'use client';

import { createElement as h, useState } from 'react';
import type { ArticleEditorValues } from '../../../components/editor/article-editor';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleEditor } from '../../../components/editor/article-editor.ts';

/** Presentation only: the guarded save route and the server composition stay server-side. */
export interface EditorFormProps {
  initial: ArticleEditorValues;
  saveUrl: string;
}

const messages = {
  idle: 'Los cambios están solo en esta pantalla hasta que guardes.',
  saving: 'Guardando…',
  saved: 'Cambios guardados.',
  failed: 'No se pudieron guardar los cambios. Probá de nuevo en unos minutos.',
} as const;

export function EditorForm({ initial, saveUrl }: EditorFormProps) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<keyof typeof messages>('idle');
  const saving = status === 'saving';
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
  return h('section', { 'aria-label': 'Editor del borrador' },
    h('div', { className: 'grid gap-8' },
      h(ArticleEditor, { values, onChange: next => { setValues(next); setStatus('idle'); } }),
      h('div', { className: 'grid gap-3' },
        h('button', {
          type: 'button', onClick: () => void save(), disabled: saving,
          className: 'cursor-pointer justify-self-start rounded border border-[#a1efb5] bg-[#a1efb5] px-4 py-3 font-mono text-xs text-[#0b100d] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a1efb5] disabled:cursor-default disabled:opacity-55',
        }, 'Guardar cambios'),
        h('p', { role: 'status', className: 'font-mono text-xs text-[#a6b9ac]' }, messages[status]),
        h('p', { className: 'font-mono text-xs text-[#a6b9ac]' }, 'La vista previa muestra la última versión guardada.'),
      ),
    ),
  );
}
