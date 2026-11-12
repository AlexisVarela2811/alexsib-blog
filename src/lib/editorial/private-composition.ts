// Disconnected server-side composition. Construct only with trusted dependencies;
// it does not enable routes, and upload reconciliation errors are server-only.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialPersistence, createEditorialService } from './service.ts';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { registerMedia } from '../media/membership.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { uploadImage } from '../uploads/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { uploadWithIntent } from '../uploads/intent-upload.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createIntent, findIntent, transitionIntent, registerIntent } from '../uploads/intent.ts';

type EditorialDeps = Parameters<typeof createEditorialService>[0];
type UploadDeps = Parameters<typeof uploadImage>[1];
type Auth = { authorize: (cookie: unknown, origin: unknown) => Promise<boolean>; authorizeRead: (cookie: unknown) => Promise<boolean> };

type Dependencies = {
  auth: Auth;
  cookie: unknown;
  origin: unknown;
  persistence: EditorialDeps['persistence'];
  put: UploadDeps['put'];
  /** Must atomically register media only for an existing draft. */
  register: UploadDeps['register'];
  token: string | undefined;
};

export function createDatabasePrivateComposition(deps: Omit<Dependencies, 'persistence' | 'register'> & { db: LibSQLDatabase }) {
  const composition = createPrivateComposition({ ...deps, persistence: createEditorialPersistence(deps.db),
    register: (postId, id, path) => registerMedia(deps.db, postId, id, path) });
  return {
    ...composition,
    upload: (input: { postId: string; mime: unknown; stream: AsyncIterable<Uint8Array> }) => uploadWithIntent({ ...input, token: deps.token }, {
      authorize: async () => {
        try { return await deps.auth.authorize(deps.cookie, deps.origin) === true; }
        catch { return false; }
      },
      create: identity => createIntent(deps.db, identity),
      find: operationId => findIntent(deps.db, operationId),
      put: deps.put,
      transition: (operationId, from, to) => transitionIntent(deps.db, operationId, from, to),
      register: operationId => registerIntent(deps.db, operationId),
    }),
  };
}

export function createPrivateComposition(deps: Dependencies) {
  const authorize = async () => {
    try { return await deps.auth.authorize(deps.cookie, deps.origin) === true; }
    catch { return false; }
  };
  const service = createEditorialService({
    persistence: deps.persistence,
    authorizeMutation: authorize,
    authorizeRead: async () => {
      try { return await deps.auth.authorizeRead(deps.cookie) === true; }
      catch { return false; }
    },
  });
  return {
    editorial: { list: service.list, read: service.read, create: service.create, edit: service.edit, publish: service.publish, unpublish: service.unpublish },
    upload: (input: { postId: string; mime: unknown; stream: AsyncIterable<Uint8Array> }) =>
      uploadImage({ ...input, token: deps.token }, { authorize, put: deps.put, register: deps.register }),
  };
}
