// Disconnected server-side controller. Construct only with a trusted authorized
// editorial service; never pass this controller or the service to a client.
import type { ArticleEditorValues } from '../../components/editor/article-editor';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { parseTags, formatTags } from '../../components/editor/article-tags.ts';
import type { createEditorialService } from './service';

type Service = Pick<ReturnType<typeof createEditorialService>, 'read' | 'create' | 'edit'>;

export function createEditorController(service: Service) {
  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); } catch { throw new Error('Editorial operation failed'); }
  };
  const input = (values: ArticleEditorValues, coverImage: string | null) => ({
    title: values.title, slug: values.slug, excerpt: values.excerpt,
    tags: parseTags(values.tags), content: values.markdown, coverImage,
  });
  return {
    load: (id: string) => run(async () => {
      const article = await service.read(id);
      if (!article) throw new Error();
      return { title: article.title, slug: article.slug, excerpt: article.excerpt,
        tags: formatTags(article.tags), markdown: article.content };
    }),
    create: (values: ArticleEditorValues) => run(async () => {
      await service.create(input(values, null));
    }),
    edit: (id: string, values: ArticleEditorValues) => run(async () => {
      const article = await service.read(id);
      if (!article) throw new Error();
      await service.edit(id, input(values, article.coverImage), { value: article.coverImage });
    }),
  };
}
