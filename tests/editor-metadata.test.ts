import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ArticleMetadata } from '../src/components/editor/article-metadata.ts';

test('renders accessible controlled metadata without private actions', () => {
  const html = renderToStaticMarkup(createElement(ArticleMetadata, {
    title: 'Título <seguro>', slug: 'mi-articulo', excerpt: 'Una invitación', tags: 'IA, Conceptos', onChange: () => {},
  }));
  for (const label of ['Título', 'Dirección del artículo', 'Una invitación a leer', 'Etiquetas']) assert.match(html, new RegExp(`>${label}</label>`));
  assert.match(html, /value="Título &lt;seguro&gt;"/);
  assert.match(html, /value="mi-articulo"/);
  assert.match(html, />Una invitación<\/textarea>/);
  assert.match(html, /value="IA, Conceptos"/);
  assert.match(html, /separadas por comas/i);
  assert.equal((html.match(/focus-visible:outline-2/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<button|type="file"|<form/i);
  const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(labels).size, 4);
  for (const id of labels) assert.ok(html.includes(`id="${id}"`));
});
