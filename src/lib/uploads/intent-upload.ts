import { randomUUID } from 'node:crypto';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { storeImage } from './blob.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { MAX_IMAGE_BYTES } from './validation.ts';

type Identity = { operationId: string; mediaId: string; postId: string; storagePath: string };
type Intent = Identity & { state: 'prepared' | 'uploaded' | 'registered' };
type Dependencies = {
  authorize: (postId: string) => Promise<boolean>;
  create: (identity: Identity) => Promise<Intent>;
  find: (operationId: string) => Promise<Intent | null>;
  put: (path: string, bytes: Buffer, options: { access: 'private'; contentType: string; token: string; allowOverwrite: false }) => Promise<unknown>;
  transition: (operationId: string, from: 'prepared', to: 'uploaded') => Promise<Intent>;
  register: (operationId: string) => Promise<Intent>;
};

/** Server-only diagnostic; never return this error or its cause to a client. */
export class IntentUploadError extends Error {
  readonly operation: 'create' | 'put' | 'transition' | 'register';
  readonly identity: Identity;
  constructor(operation: 'create' | 'put' | 'transition' | 'register', identity: Identity, cause?: unknown) {
    super('Upload requires reconciliation', { cause });
    this.operation = operation;
    this.identity = identity;
    this.name = 'IntentUploadError';
  }
}

function matches(row: Intent | null, identity: Identity, state: Intent['state']): boolean {
  return row !== null && row.operationId === identity.operationId && row.mediaId === identity.mediaId &&
    row.postId === identity.postId && row.storagePath === identity.storagePath && row.state === state;
}

/** Internal only. Dependencies must be trusted and register must be atomic. No cleanup or retry occurs here. */
export async function uploadWithIntent(input: {
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
  const operationId = randomUUID();
  const mediaId = randomUUID();
  await storeImage({ mime: input.mime, bytes: Buffer.concat(chunks, size), token: input.token,
    put: async (storagePath, bytes, options) => {
      const identity = { operationId, mediaId, postId: input.postId, storagePath };
      let created: Intent | null;
      try {
        created = await deps.create(identity);
      } catch (cause) {
        try { created = await deps.find(operationId); } catch { throw new IntentUploadError('create', identity, cause); }
        if (!matches(created, identity, 'prepared')) throw new IntentUploadError('create', identity, cause);
      }
      if (!matches(created, identity, 'prepared')) throw new IntentUploadError('create', identity);
      let stored: unknown;
      try { stored = await deps.put(storagePath, bytes, options); } catch (cause) { throw new IntentUploadError('put', identity, cause); }
      // Only an explicit null proves no object; a void adapter may have stored the bytes.
      if (stored === null) throw new IntentUploadError('put', identity);
      let uploaded: Intent;
      try { uploaded = await deps.transition(operationId, 'prepared', 'uploaded'); } catch (cause) { throw new IntentUploadError('transition', identity, cause); }
      if (!matches(uploaded, identity, 'uploaded')) throw new IntentUploadError('transition', identity);
      let registered: Intent;
      try { registered = await deps.register(operationId); } catch (cause) { throw new IntentUploadError('register', identity, cause); }
      if (!matches(registered, identity, 'registered')) throw new IntentUploadError('register', identity);
    },
  });
  return { id: mediaId };
}
