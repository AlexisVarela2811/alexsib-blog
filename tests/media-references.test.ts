import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { ContentRenderer } from '../src/components/content/content-renderer.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { extractMediaReferences } from '../src/lib/media/references.ts';

const id = '12345678-1234-1234-1234-123456789abc';
const other = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const url = `/media/${id}`;
const render = (markdown: string) => renderToStaticMarkup(createElement(ContentRenderer, { markdown }));

test('collects inline, resolved references and cover once with renderer parity', () => {
  const markdown = `![inline](${url}) ![x][FIRST] ![first][] ![first]\n\n[first]: ${url}\n\n![other](/media/${other})`;
  assert.equal((render(markdown).match(/<img\b/g) || []).length, 5);
  assert.deepEqual(extractMediaReferences(markdown, url), [id, other]);
  assert.deepEqual(extractMediaReferences('', `/media/${other}`), [other]);
});

test('ignores unresolved references, links, escaped syntax, code and skipped HTML like renderer', () => {
  const markdown = `![missing][nope] [link](${url}) \\![escaped](${url})\n\n\`![code](${url})\`\n\n\`\`\`md\n![code](${url})\n\`\`\`\n\n<img src="${url}">\n\n[unused]: ${url}`;
  assert.doesNotMatch(render(markdown), /<img\b/);
  assert.deepEqual(extractMediaReferences(markdown), []);
});

test('uses first case-insensitive definition and recognizes images inside inline HTML', () => {
  const markdown = `<span>![inside][A]</span>\n\n[a]: ${url}\n[A]: /media/${other}`;
  assert.match(render(markdown), new RegExp(`<img[^>]+src="${url}"`));
  assert.deepEqual(extractMediaReferences(markdown), [id]);
});

test('rejects noncanonical rendered image URLs and invalid cover references', () => {
  for (const bad of [
    'https://example.com/image.png', '//example.com/x', '/media/not-a-uuid',
    `/media/${id.toUpperCase()}`, `${url}?x=1`, `${url}#frag`, `${url}/`,
    `media/${id}`, `/media/%31${id.slice(1)}`, '',
  ]) {
    assert.throws(() => extractMediaReferences(`![x](<${bad}>)`), /Invalid media reference/);
    assert.throws(() => extractMediaReferences(`![x][ref]\n\n[ref]: <${bad}>`), /Invalid media reference/);
    assert.throws(() => extractMediaReferences('', bad), /Invalid media reference/);
  }
});

test('handles Markdown URL escapes as the renderer does', () => {
  const markdown = `![x](/media/${id} "title") ![x](/media/${id.replace('-', '\\-')})`;
  assert.equal((render(markdown).match(/<img\b/g) || []).length, 2);
  assert.deepEqual(extractMediaReferences(markdown), [id]);
});
