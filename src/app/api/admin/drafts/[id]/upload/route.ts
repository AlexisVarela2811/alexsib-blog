// Guarded image upload route for one private draft. Authorization is
// server-side and fail-closed: the upload needs a valid `__Host-admin` session
// and the exact configured Origin header, checked through the same session
// module as the editor and publish routes before a single body byte is read,
// and every failure — including provider, reconciliation and configuration
// errors — answers with the same generic rejection and no internal detail, no
// storage path and no bucket name. The body is read with a streaming byte cap
// identical to the existing upload limit, cancelling the stream as soon as it
// is exceeded, so nothing larger is ever buffered; the file signature is then
// validated again by the upload composition before anything reaches storage.
//
// Success choice: a documented JSON answer with the /media/<id> path. The
// editor is a client component that already saves through fetch, so a plain
// form POST would reload the page and discard unsaved edits; the JSON answer
// lets the editor insert the reference into the Markdown without navigation.
// A failed or ambiguous provider outcome is reconciled by the durable intent
// row the composition leaves behind — nothing is deleted and no partial state
// is returned to the client.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { authorizeMutation, uploadDraftImage } from '../../../../../admin/editorial-session.ts';
import { put as blobPut } from '@vercel/blob';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { MAX_IMAGE_BYTES } from '../../../../../../lib/uploads/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rejection = () => new Response('No se pudo subir la imagen', { status: 400, headers: { 'Cache-Control': 'no-store' } });
// Only raw image bytes are accepted. The declared type is checked here and the
// container signature is validated again before storage, so a spoofed header
// never reaches the provider.
const imageType = /^image\/(?:jpeg|png|webp)$/i;

function cappedStream(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () { for (const chunk of chunks) yield chunk; })();
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // 1. Authorize before reading any body byte.
    const cookie = request.headers.get('cookie');
    const requestOrigin = request.headers.get('origin');
    if (!await authorizeMutation(cookie, requestOrigin)) return rejection();
    // 2. Only one accepted image type, declared on the request itself.
    if (!imageType.test(request.headers.get('content-type') ?? '')) return rejection();
    // 3. Stream the body under the exact upload limit, cancelling the stream
    //    as soon as it is exceeded so an oversized upload never buffers in full.
    if (!request.body) return rejection();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { void reader.cancel().catch(() => {}); return rejection(); }
      chunks.push(value);
    }
    // 4. Upload through the authorized composition: durable intent, private
    //    storage, atomic registration owned by the draft. A false or thrown
    //    outcome — including an ambiguous provider result — is the same
    //    generic rejection; reconciliation stays server-side.
    const { id } = await context.params;
    const mediaId = await uploadDraftImage(cookie, requestOrigin, id, request.headers.get('content-type'), cappedStream(chunks), blobPut);
    if (!mediaId) return rejection();
    return new Response(JSON.stringify({ path: `/media/${mediaId}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch { return rejection(); }
}
