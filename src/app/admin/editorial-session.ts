// Guarded server-side session for the private editor page, the preview page and
// the save route handler. Each function builds a trusted composition per request
// from explicit server environment values; no draft service, database client,
// configuration value or session token ever reaches a client. Every failure is
// collapsed to a generic outcome: pages redirect to /login when the session
// cannot be verified, and the save route answers with its generic rejection.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDatabase } from '../../db/client.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createAuthComposition } from '../../lib/auth/composition.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialPersistence, createEditorialService } from '../../lib/editorial/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorController } from '../../lib/editorial/editor-controller.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createDatabasePrivateComposition } from '../../lib/editorial/private-composition.ts';
import { put as blobPut } from '@vercel/blob';
import type { ArticleEditorValues } from '../../components/editor/article-editor';

export type EditorValues = { title: string; slug: string; excerpt: string; tags: string; markdown: string };
// A draft with values always carries its stored cover (a blog-managed path, a
// legacy external URL or null) so the editor can show it and offer removal.
export type EditorOutcome =
  | { unauthorized: true }
  | { unauthorized: false; values: null }
  | { unauthorized: false; values: EditorValues; cover: string | null };
export type PreviewDraft = { title: string; excerpt: string; tags: string[]; content: string };
export type PreviewOutcome = { unauthorized: true } | { unauthorized: false; draft: PreviewDraft | null };
/** Minimal row shape for the panel; nothing else about the storage reaches the browser.
 * `legacyCover` marks a draft whose cover is an external URL, which publishing
 * always rejects until it is removed [S2: "No, solo imágenes del blog"]. */
export type PanelArticle = { id: string; title: string; tags: string[]; legacyCover?: boolean };
export type PanelOutcome = { unauthorized: true } | { unauthorized: false; drafts: PanelArticle[] | null; published: PanelArticle[] | null };

function authConfig() {
  return {
    origin: process.env.AUTH_ORIGIN,
    username: process.env.AUTH_USERNAME,
    passwordHash: process.env.AUTH_PASSWORD_HASH,
    sessionSecret: process.env.AUTH_SESSION_SECRET,
  };
}

type Composition = ReturnType<typeof createAuthComposition>;

/** Bounded dynamic-segment id: the persistence layer only accepts plain short ids. */
function validId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.length <= 128;
}

function openSession(cookie: string, origin: string | undefined) {
  const { db, client } = createDatabase();
  const auth: Composition = createAuthComposition(authConfig(), client);
  const service = createEditorialService({
    persistence: createEditorialPersistence(db),
    authorizeRead: async () => {
      try { return await auth.authorizeRead(cookie) === true; } catch { return false; }
    },
    authorizeMutation: async () => {
      try { return origin !== undefined && await auth.authorize(cookie, origin) === true; } catch { return false; }
    },
  });
  return { auth, client, service, controller: createEditorController(service) };
}

/** Map one draft for the editor page. Sessions and drafts are only read. */
export async function loadEditorDraft(cookie: unknown, id: unknown): Promise<EditorOutcome> {
  if (typeof cookie !== 'string' || !cookie || !validId(id)) return { unauthorized: true };
  try {
    const session = openSession(cookie, undefined);
    try {
      try { if (await session.auth.authorizeRead(cookie) !== true) return { unauthorized: true }; }
      catch { return { unauthorized: true }; }
      // The controller read is the already-authorized editor mapping; the cover
      // comes from the same authorized read path and reaches only this page.
      const values = await session.controller.load(id);
      const article = await session.service.read(id);
      return { unauthorized: false, values, cover: article ? article.coverImage ?? null : null };
    } catch {
      // Authorized readers get a generic no-draft answer; storage state is not revealed.
      return { unauthorized: false, values: null };
    } finally { session.client.close(); }
  } catch { return { unauthorized: true }; }
}

/** Map one draft for the preview page, in the public reading direction. */
export async function loadPreviewDraft(cookie: unknown, id: unknown): Promise<PreviewOutcome> {
  if (typeof cookie !== 'string' || !cookie || !validId(id)) return { unauthorized: true };
  try {
    const session = openSession(cookie, undefined);
    try {
      try { if (await session.auth.authorizeRead(cookie) !== true) return { unauthorized: true }; }
      catch { return { unauthorized: true }; }
      const article = await session.service.read(id);
      return article
        ? { unauthorized: false, draft: { title: article.title, excerpt: article.excerpt, tags: article.tags ?? [], content: article.content } }
        : { unauthorized: false, draft: null };
    } catch {
      return { unauthorized: false, draft: null };
    } finally { session.client.close(); }
  } catch { return { unauthorized: true }; }
}

/** Authorize one private mutation: the `__Host-admin` session cookie AND the exact
 * configured Origin, through the existing auth composition. The save route calls
 * this before reading any body byte, so an unauthorized request never buffers a body. */
export async function authorizeMutation(cookie: unknown, origin: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin) return false;
  try {
    const { client } = createDatabase();
    try {
      const auth = createAuthComposition(authConfig(), client);
      return await auth.authorize(cookie, origin) === true;
    } finally { client.close(); }
  } catch { return false; }
}

/** Verify the session for a page that has no draft to read yet, such as the
 * create-article page. Fail closed: anything but a verified session is false. */
export async function hasPrivateSession(cookie: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie) return false;
  try {
    const { client } = createDatabase();
    try {
      const auth = createAuthComposition(authConfig(), client);
      return await auth.authorizeRead(cookie) === true;
    } finally { client.close(); }
  } catch { return false; }
}

/** Create one new draft from the editor's values through the authorized service.
 * The panel offers no cover on creation, so the row starts without one. Generic
 * outcome only: the new draft id, or null when anything fails. */
export async function createPrivateDraft(cookie: unknown, origin: unknown, values: unknown): Promise<string | null> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin) return null;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  try {
    const session = openSession(cookie, origin);
    try {
      const created = await session.controller.create(values as ArticleEditorValues);
      return created && typeof created.id === 'string' && created.id ? created.id : null;
    } finally { session.client.close(); }
  } catch { return null; }
}

/** Publish one draft through the authorized service. The persistence layer
 * writes the published-media membership inside the same transaction, so a
 * draft referencing an image it does not own fails atomically and stays a
 * draft. Generic outcome only. */
export async function publishPrivateDraft(cookie: unknown, origin: unknown, id: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin || !validId(id)) return false;
  try {
    const session = openSession(cookie, origin);
    try {
      await session.service.publish(id);
      return true;
    } finally { session.client.close(); }
  } catch { return false; }
}

/** Revert one published article to a draft through the authorized service; the
 * persistence layer removes the published-media membership in the same
 * transaction, so its images become private again atomically. Generic outcome only. */
export async function unpublishPrivateDraft(cookie: unknown, origin: unknown, id: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin || !validId(id)) return false;
  try {
    const session = openSession(cookie, origin);
    try {
      await session.service.unpublish(id);
      return true;
    } finally { session.client.close(); }
  } catch { return false; }
}

/** List the panel's drafts and published articles through the authorized
 * service, one read of every article partitioned by status. Authorized readers
 * whose storage fails get the generic not-loaded outcome; anonymous readers
 * learn nothing about whether the panel or storage exists. */
export async function loadPanelArticles(cookie: unknown): Promise<PanelOutcome> {
  if (typeof cookie !== 'string' || !cookie) return { unauthorized: true };
  try {
    const session = openSession(cookie, undefined);
    try {
      try { if (await session.auth.authorizeRead(cookie) !== true) return { unauthorized: true }; }
      catch { return { unauthorized: true }; }
      const articles = await session.service.list();
      const map = (article: { id: string; title: string; tags: string[] | null; status: string; coverImage: string | null }): PanelArticle => ({
        id: article.id, title: article.title, tags: article.tags ?? [],
        ...(article.coverImage !== null && !article.coverImage.startsWith('/media/') ? { legacyCover: true } : {}),
      });
      return {
        unauthorized: false,
        drafts: articles.filter(article => article.status === 'draft').map(map),
        published: articles.filter(article => article.status === 'published').map(map),
      };
    } catch {
      return { unauthorized: false, drafts: null, published: null };
    } finally { session.client.close(); }
  } catch { return { unauthorized: true }; }
}

/** Save one draft edit with the controller's cover-image comparison; generic
 * outcome only. The payload may carry an explicit cover instruction: `null`
 * clears the stored cover and a blog-managed /media/<uuid> path replaces it;
 * without the key the stored cover is preserved exactly, including a legacy
 * external one. Any other value, or one the controller rejects (an external
 * URL, a malformed path), fails with the generic outcome and changes nothing. */
export async function savePrivateDraft(cookie: unknown, origin: unknown, id: unknown, values: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin || !validId(id)) return false;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const cover = (values as { cover?: unknown }).cover;
  if (cover !== undefined && cover !== null && typeof cover !== 'string') return false;
  try {
    const session = openSession(cookie, origin);
    try {
      // The controller reads the draft and passes the exact cover comparison;
      // it enforces the managed-path shape itself.
      await session.controller.edit(id, values as ArticleEditorValues, cover as string | null | undefined);
      return true;
    } finally { session.client.close(); }
  } catch { return false; }
}

/** The exact private-storage shape the upload composition expects; the real
 * provider is @vercel/blob's put with a private access mode. */
type BlobPut = (
  pathname: string,
  body: Buffer,
  options: { access: 'private'; contentType: string; token: string; allowOverwrite: false },
) => Promise<unknown>;

/** Upload one image for one draft through the authorized private composition:
 * durable intent reservation, private Blob storage and atomic media
 * registration owned by that draft. The image signature and the byte limit
 * are validated again by the composition before anything reaches storage. A
 * failed or ambiguous provider outcome leaves the durable intent row for
 * reconciliation, deletes nothing it cannot prove it created, and stays
 * server-side: this function answers only the new media id — the /media/<id>
 * path source — or null, never an internal detail, storage path or bucket. */
export async function uploadDraftImage(
  cookie: unknown,
  origin: unknown,
  id: unknown,
  mime: unknown,
  stream: AsyncIterable<Uint8Array> | null,
  put: BlobPut = blobPut,
): Promise<string | null> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin || !validId(id)) return null;
  if (!stream) return null;
  try {
    const { db, client } = createDatabase();
    try {
      const auth = createAuthComposition(authConfig(), client);
      const composition = createDatabasePrivateComposition({
        db,
        auth: {
          authorize: (c, o) => auth.authorize(c, o),
          authorizeRead: c => auth.authorizeRead(c),
        },
        cookie,
        origin,
        put,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      const uploaded = await composition.upload({ postId: id, mime, stream });
      return uploaded.id;
    } finally { client.close(); }
  } catch { return null; }
}
