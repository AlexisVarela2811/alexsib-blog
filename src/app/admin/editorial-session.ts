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
import type { ArticleEditorValues } from '../../components/editor/article-editor';

export type EditorValues = { title: string; slug: string; excerpt: string; tags: string; markdown: string };
export type EditorOutcome = { unauthorized: true } | { unauthorized: false; values: EditorValues | null };
export type PreviewDraft = { title: string; excerpt: string; tags: string[]; content: string };
export type PreviewOutcome = { unauthorized: true } | { unauthorized: false; draft: PreviewDraft | null };

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
      // The controller read is the already-authorized editor mapping.
      return { unauthorized: false, values: await session.controller.load(id) };
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

/** Save one draft edit with the controller's cover-image comparison; generic outcome only. */
export async function savePrivateDraft(cookie: unknown, origin: unknown, id: unknown, values: unknown): Promise<boolean> {
  if (typeof cookie !== 'string' || !cookie || typeof origin !== 'string' || !origin || !validId(id)) return false;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  try {
    const session = openSession(cookie, origin);
    try {
      // The controller reads the draft and passes the exact cover comparison.
      await session.controller.edit(id, values as ArticleEditorValues);
      return true;
    } finally { session.client.close(); }
  } catch { return false; }
}
