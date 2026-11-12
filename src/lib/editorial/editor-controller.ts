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
  // Only a blog-managed media path may be set as a cover. A legacy external
  // HTTPS cover that already exists on a draft can be kept there (an edit that
  // re-submits it), but a save can never introduce a new external one: the
  // persistence layer only accepts /media/<uuid> paths for new covers and
  // publishing rejects anything else [S2: "No, solo imágenes del blog"].
  const managedCover = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
    // `cover` is an explicit instruction from the editor: undefined preserves
    // the stored cover exactly as before (including a legacy external one),
    // null clears it and a managed path replaces it. Any other value is
    // rejected before anything is read, so the stored row is never touched.
    // The optimistic comparison stays on the cover read here, exactly as in
    // the keep case, so a concurrent cover change still rejects the stale edit.
    edit: (id: string, values: ArticleEditorValues, cover?: string | null) => run(async () => {
      if (typeof cover === 'string' ? !managedCover.test(cover) : cover !== undefined && cover !== null) throw new Error();
      const article = await service.read(id);
      if (!article) throw new Error();
      await service.edit(id, input(values, cover === undefined ? article.coverImage : cover), { value: article.coverImage });
    }),
  };
}
