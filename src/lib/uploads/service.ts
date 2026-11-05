import { randomUUID } from 'node:crypto';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { storeImage } from './blob.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { MAX_IMAGE_BYTES } from './validation.ts';

type Dependencies = {
  authorize: (postId: string) => Promise<boolean>;
  put: (pathname: string, body: Buffer, options: { access: 'private'; contentType: string; token: string; allowOverwrite: false }) => Promise<unknown>;
  register: (postId: string, id: string, storagePath: string) => Promise<unknown>;
};

type Reconciliation =
  | { operation: 'put'; outcome: 'uncertain'; postId: string; storagePath: string }
  | { operation: 'register'; outcome: 'uncertain'; postId: string; id: string; storagePath: string };

/** Server-only recovery details. Never expose this error to an untrusted client. */
export class UploadReconciliationError extends Error {
  readonly reconciliation: Reconciliation;
  constructor(reconciliation: Reconciliation, cause: unknown) {
    super('Upload requires reconciliation', { cause });
    this.reconciliation = reconciliation;
    this.name = 'UploadReconciliationError';
  }
}

/** Disconnected internal primitive; caller supplies authorization and draft registration.
 * Failed writes may have committed. Reconcile before any cleanup; never expose errors to clients.
 */
export async function uploadImage(input: {
  postId: string; mime: unknown; token: string | undefined; stream: AsyncIterable<Uint8Array>;
}, deps: Dependencies): Promise<{ id: string }> {
  if (await deps.authorize(input.postId) !== true) throw new Error('Unauthorized');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input.stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid upload stream');
    size += chunk.byteLength;
    if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
    chunks.push(Buffer.from(chunk));
  }
  let path = '';
  await storeImage({ mime: input.mime, bytes: Buffer.concat(chunks, size), token: input.token,
    put: async (pathname, body, options) => {
      path = pathname;
      try {
        return await deps.put(pathname, body, options);
      } catch (cause) {
        throw new UploadReconciliationError({ operation: 'put', outcome: 'uncertain', postId: input.postId, storagePath: pathname }, cause);
      }
    },
  });
  const id = randomUUID();
  try {
    await deps.register(input.postId, id, path);
  } catch (cause) {
    throw new UploadReconciliationError({ operation: 'register', outcome: 'uncertain', postId: input.postId, id, storagePath: path }, cause);
  }
  return { id };
}
