import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { DraftEditor } from '../src/components/editor/draft-editor.ts';

const render = (markdown: string) => renderToStaticMarkup(createElement(DraftEditor, { markdown, onChange: () => {} }));

test('shows controlled draft content and its Markdown preview without executable content', () => {
  const html = render('# Hola\n\n**texto**\n\n<script>alert(1)</script>\n\n[mal](javascript:alert%281%29)');
  assert.match(html, /Borrador sin guardar/);
  assert.match(html, /Contenido · Markdown/);
  assert.match(html, /Vista previa/);
  assert.match(html, /<h1>Hola<\/h1>/);
  assert.match(html, /<strong>texto<\/strong>/);
  assert.doesNotMatch(html, /<script|href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
});

test('preview uses the shared allowlisted figure renderer', () => {
  const html = render('```context-window\n```');
  assert.match(html, /<figure/);
  assert.match(html, /Simplificación educativa/);
});
