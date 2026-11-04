import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ContentRenderer } from '../src/components/content/content-renderer.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { advanceContext, resetContext, initialContext } from '../src/lib/content/context-window.ts';

const render = (markdown: string) => renderToStaticMarkup(createElement(ContentRenderer, { markdown }));

test('renders Markdown and GFM without executing HTML or unsafe URLs', () => {
  const html = render('# Hola\n\n**fuerte** ~~no~~ [bien](https://example.com) [mal](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
  assert.match(html, /<h1>Hola<\/h1>/);
  assert.match(html, /<strong>fuerte<\/strong>/);
  assert.match(html, /<del>no<\/del>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<script|<img|onerror|javascript:/i);
});

test('only the empty context-window directive renders a figure', () => {
  const html = render('```context-window\n```\n\n```context-window\nalert(1)\n```\n\n```otro\n```');
  assert.equal((html.match(/<figure/g) || []).length, 1);
  assert.match(html, /Simplificación educativa/);
  assert.match(html, /Avanzar/);
  assert.match(html, /Reiniciar/);
  assert.match(html, /alert\(1\)/);
  assert.match(html, /language-otro/);
});

test('unsafe link and image schemes remain inert while relative links work', () => {
  const html = render('[script](javascript:alert%281%29) [data](data:text/html,example) [vb](vbscript:example) [relative](/articulo/ejemplo)\n\n![image](javascript:alert%281%29)');
  assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data|vbscript):/i);
  assert.match(html, /href="\/articulo\/ejemplo"/);
  assert.match(html, />relative<\/a>/);
});

test('figure directives reject metadata, modified names, and nonempty bodies', () => {
  for (const directive of [
    '```context-window extra\n```',
    '```context-window-modified\n```',
    '```context-window\nexample\n```',
  ]) {
    const html = render(directive);
    assert.doesNotMatch(html, /<figure/);
    assert.match(html, /<pre/);
  }
  assert.match(render('```context-window\n```'), /<figure/);
});

test('context figure advances to a bounded end and resets', () => {
  let state = initialContext;
  const first = state;
  state = advanceContext(state);
  assert.notDeepEqual(state, first);
  for (let i = 0; i < 50; i++) state = advanceContext(state);
  assert.deepEqual(advanceContext(state), state);
  assert.deepEqual(resetContext(), first);
});

test('code fences remain inert and are not interpreted as nested directives', () => {
  const html = render('````md\n```context-window\n```\n````');
  assert.doesNotMatch(html, /<figure/);
  assert.match(html, /context-window/);
});
