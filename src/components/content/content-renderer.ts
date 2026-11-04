import { createElement as h } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Node's native TypeScript runner requires the extension.
// @ts-expect-error TypeScript config does not enable TS extension imports.
import { ContextWindowFigure } from './context-window-figure.ts';

/** Render article text without evaluating MDX or enabling raw HTML.
 * An empty fenced block named `context-window` is the only figure directive.
 */
export function ContentRenderer({ markdown }: { markdown: string }) {
  return h(Markdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    components: {
      pre({ node, children, ...props }) {
        const code = node?.children.length === 1 ? node.children[0] : undefined;
        if (code?.type === 'element' && code.tagName === 'code' &&
          Array.isArray(code.properties.className) && code.properties.className.length === 1 &&
          code.properties.className[0] === 'language-context-window' &&
          !code.data?.meta && code.children.length === 1 && code.children[0].type === 'text' && code.children[0].value === '') {
          return h(ContextWindowFigure);
        }
        return h('pre', { ...props, className: 'overflow-x-auto' }, children);
      },
    },
    children: markdown,
  });
}
