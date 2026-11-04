import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const managedImage = /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Collect rendered Markdown image IDs and an optional cover; reject other URLs.
 * Use the renderer's own Markdown-to-HTML pipeline so reference resolution,
 * escaped syntax, GFM and skipped raw HTML have the same interpretation.
 * This validates syntax only, not ownership, existence or access.
 */
export function extractMediaReferences(markdown: string, cover?: string | null): string[] {
  const ids = new Set<string>();
  function collect(url: string) {
    const match = managedImage.exec(url);
    if (!match) throw new Error('Invalid media reference');
    ids.add(match[1]);
  }

  Markdown({
    children: markdown,
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    urlTransform(url, key, node) {
      if (node.tagName === 'img' && key === 'src') collect(url);
      return url;
    },
  });
  if (cover !== undefined && cover !== null) collect(cover);
  return [...ids];
}
