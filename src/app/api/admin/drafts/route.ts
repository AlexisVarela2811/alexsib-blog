// Guarded create route for a new private draft. Authorization is server-side and
// fail-closed: creating needs a valid `__Host-admin` session and the exact
// configured Origin header, exactly as the auth boundary provides it, and every
// failure — including storage and configuration errors — answers with the same
// generic rejection and no internal details. Authorization and the Content-Type
// check happen before a single body byte is read, and the body is read with the
// same streaming byte cap as the save route. The answer is the new draft id the
// editor navigates to, never storage state.
import { randomUUID } from 'node:crypto';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { authorizeMutation, createPrivateDraft } from '../../../admin/editorial-session.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rejection = () => new Response('No se pudo crear el artículo', { status: 400, headers: { 'Cache-Control': 'no-store' } });
// Same bound as the save route: a draft stores at most 200000 content characters
// plus metadata, and multi-byte UTF-8 can only make the encoded payload larger,
// so the byte cap is the conservative unit.
const maxBodyBytes = 1_500_000;
// A new draft carries no cover instruction: covers are set on an existing draft,
// where the editor can offer removal of a legacy external one [S2].
const payloadKeys = new Set(['title', 'slug', 'excerpt', 'tags', 'markdown']);

/** Derive a stable ASCII slug from a title. Accents are decomposed and dropped,
 * everything that is not [a-z0-9] becomes a dash, and an empty derivation falls
 * back to a random slug so a title in another script still creates a draft. */
function slugFromTitle(title: unknown): string {
  const derived = typeof title === 'string'
    ? title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/g, '')
    : '';
  return derived || `articulo-${randomUUID().slice(0, 8)}`;
}

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Authorize before reading any body byte.
    if (!await authorizeMutation(request.headers.get('cookie'), request.headers.get('origin'))) return rejection();
    // 2. Only a JSON body is accepted; the charset parameter is optional.
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('content-type') ?? '')) return rejection();
    // 3. Stream the body under the byte cap, cancelling as soon as it is exceeded.
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
    // 4. Only the editor's own fields may be sent; unknown keys never reach the
    //    controller's mapping and are rejected with the same generic rejection.
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).some(key => !payloadKeys.has(key))) return rejection();
    const slug = (payload as { slug?: unknown }).slug;
    const values = { ...payload, slug: typeof slug === 'string' && slug.trim() ? slug : slugFromTitle((payload as { title?: unknown }).title) };
    const id = await createPrivateDraft(
      request.headers.get('cookie') ?? undefined,
      request.headers.get('origin'),
      values,
    );
    return id
      ? Response.json({ id }, { headers: { 'Cache-Control': 'no-store' } })
      : rejection();
  } catch { return rejection(); }
}
