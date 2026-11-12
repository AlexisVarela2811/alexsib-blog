// Guarded save route for one private draft. Authorization is server-side and
// fail-closed: a mutation needs a valid `__Host-admin` session and the exact
// configured Origin header, exactly as the auth boundary provides it, and every
// failure — including storage and configuration errors — answers with the same
// generic rejection and no internal details. Authorization and the Content-Type
// check happen before a single body byte is read, and the body itself is read
// with a streaming byte cap so a large request never buffers unbounded memory.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { authorizeMutation, savePrivateDraft } from '../../../../admin/editorial-session.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rejection = () => new Response('No se pudieron guardar los cambios', { status: 400, headers: { 'Cache-Control': 'no-store' } });
// Bounded body cap in BYTES, not characters: the streaming reader sums each
// chunk's byteLength and cancels the stream as soon as the cap is exceeded, so
// nothing larger than this is ever buffered. A draft stores at most 200000
// content characters plus metadata; multi-byte UTF-8 can only make the encoded
// payload larger, so the byte cap is the conservative unit.
const maxBodyBytes = 1_500_000;
// Only the editor's own fields may be sent. Unknown keys are rejected with the
// same generic rejection, mirroring the draft validation strictness instead of
// silently dropping them. `cover` is an explicit instruction: null clears the
// stored cover and a managed /media/<uuid> path replaces it; when the key is
// absent the current cover is preserved exactly, including a legacy external
// one. The session and the controller enforce the accepted shapes.
const payloadKeys = new Set(['title', 'slug', 'excerpt', 'tags', 'markdown', 'cover']);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // 1. Authorize before reading any body byte.
    if (!await authorizeMutation(request.headers.get('cookie'), request.headers.get('origin'))) return rejection();
    // 2. Only a JSON body is accepted; the charset parameter is optional.
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('content-type') ?? '')) return rejection();
    // 3. Stream the body under the byte cap, cancelling the stream as soon as it
    //    is exceeded so an oversized upload never buffers in full.
    if (!request.body) return rejection();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) { void reader.cancel().catch(() => {}); return rejection(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // 4. Unknown payload keys never reach the controller's mapping: reject them.
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).some(key => !payloadKeys.has(key))) return rejection();
    const { id } = await context.params;
    const saved = await savePrivateDraft(
      request.headers.get('cookie') ?? undefined,
      request.headers.get('origin'),
      id,
      payload,
    );
    if (!saved) return rejection();
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return rejection(); }
}
