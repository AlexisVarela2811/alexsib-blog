import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import type { ArticleMetadataProps } from '../src/components/editor/article-metadata.ts';
import type { DraftEditorProps } from '../src/components/editor/draft-editor.ts';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleEditor, parseTags, formatTags } from '../src/components/editor/article-editor.ts';

const values = { title: 'Título', slug: 'mi-articulo', excerpt: 'Resumen', tags: ' IA, , Web ', markdown: '# Hola\n\n<script>alert(1)</script>' };

test('converts comma-separated tags deterministically without empty entries', () => {
  assert.deepEqual(parseTags(' IA, , Web ,\t,IA '), ['IA', 'Web', 'IA']);
  assert.deepEqual(parseTags(' ,  '), []);
  assert.equal(formatTags([' IA ', '', ' Web ']), 'IA, Web');
});

test('composes controlled metadata and safe Markdown preview', () => {
  const html = renderToStaticMarkup(createElement(ArticleEditor, { values, onChange: () => {} }));
  for (const text of ['Título', 'mi-articulo', 'Resumen', ' IA, , Web ', 'Vista previa', '<h1>Hola</h1>']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<script|<form|type="file"/i);
});

test('forwards each field and content without changing other values', () => {
  const changes: typeof values[] = [];
  const tree = ArticleEditor({ values, onChange: (next) => changes.push(next) });
  const [metadata, draft] = (tree as unknown as ReactElement<{ children: [ReactElement<ArticleMetadataProps>, ReactElement<DraftEditorProps>] }>).props.children;
  for (const field of ['title', 'slug', 'excerpt', 'tags'] as const) {
    metadata.props.onChange(field, 'nuevo');
    assert.deepEqual(changes.pop(), { ...values, [field]: 'nuevo' });
  }
  draft.props.onChange('contenido');
  assert.deepEqual(changes.pop(), { ...values, markdown: 'contenido' });
});
