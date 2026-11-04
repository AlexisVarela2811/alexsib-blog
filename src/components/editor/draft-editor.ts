'use client';

import { createElement as h, useId } from 'react';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ContentRenderer } from '../content/content-renderer.ts';

/** Controlled by a client-side parent; this component does not persist or publish. */
export interface DraftEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
}

export function DraftEditor({ markdown, onChange }: DraftEditorProps) {
  const id = useId();
  return h('section', { 'aria-label': 'Editor de borrador', className: 'text-[#edf4ef]' },
    h('p', { className: 'font-mono text-sm text-[#a1efb5]' }, 'Borrador sin guardar · Nada se guarda ni se publica desde este editor.'),
    h('div', { className: 'grid gap-8 md:grid-cols-2' },
      h('div', { className: 'min-w-0' },
        h('label', { htmlFor: id, className: 'mb-2 block font-mono text-sm' }, 'Contenido · Markdown'),
        h('textarea', {
          id, value: markdown, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
          spellCheck: true, rows: 18,
          className: 'min-h-[460px] w-full resize-y rounded border border-[#5b7663] bg-[#0b100d] p-3 font-mono text-sm leading-loose text-[#edf4ef] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a1efb5]',
        }),
      ),
      h('section', { 'aria-label': 'Vista previa', className: 'min-w-0 rounded border border-[#304537] bg-[#111a15] p-6' },
        h('h2', { className: 'mb-5 font-mono text-sm text-[#a1efb5]' }, 'Vista previa'),
        h('div', { className: 'article-text' }, h(ContentRenderer, { markdown })),
      ),
    ),
  );
}
