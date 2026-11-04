'use client';

import { createElement as h, useId } from 'react';

/** Tags are comma-separated text so editing never silently normalizes user input. */
export interface ArticleMetadataProps {
  title: string;
  slug: string;
  excerpt: string;
  tags: string;
  onChange: (field: 'title' | 'slug' | 'excerpt' | 'tags', value: string) => void;
}

/** Controlled presentation only; the parent owns conversion, validation and storage. */
export function ArticleMetadata({ title, slug, excerpt, tags, onChange }: ArticleMetadataProps) {
  const id = useId();
  const inputClass = 'block w-full rounded border border-[#5b7663] bg-[#0b100d] p-3 text-[#edf4ef] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a1efb5]';
  const labelClass = 'mb-2 block font-mono text-sm';
  const field = (name: 'title' | 'slug' | 'excerpt' | 'tags', label: string, value: string) =>
    h('div', { key: name },
      h('label', { htmlFor: `${id}-${name}`, className: labelClass }, label),
      name === 'excerpt'
        ? h('textarea', { id: `${id}-${name}`, value, rows: 3, className: inputClass, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(name, event.currentTarget.value) })
        : h('input', { id: `${id}-${name}`, value, type: 'text', className: inputClass, 'aria-describedby': name === 'tags' ? `${id}-tags-hint` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(name, event.currentTarget.value) }),
      name === 'tags' ? h('p', { id: `${id}-tags-hint`, className: 'mt-2 text-sm text-[#a6b9ac]' }, 'Etiquetas separadas por comas.') : null,
    );
  return h('section', { 'aria-label': 'Detalles del artículo', className: 'grid gap-5 rounded border border-[#304537] bg-[#111a15] p-6 text-[#edf4ef]' },
    h('h2', { className: 'font-mono text-sm text-[#a1efb5]' }, '// detalles'),
    field('title', 'Título', title), field('slug', 'Dirección del artículo', slug),
    field('excerpt', 'Una invitación a leer', excerpt), field('tags', 'Etiquetas', tags),
  );
}
