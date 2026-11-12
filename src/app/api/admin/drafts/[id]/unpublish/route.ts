// Guarded unpublish route for one published article. Authorization is
// server-side and fail-closed: the mutation needs a valid `__Host-admin`
// session and the exact configured Origin header, checked through the same
// session module as the editor before anything else happens, and every failure
// — including storage, configuration and wrong-state errors — answers with the
// same generic rejection and no internal details. The route takes no payload
// and never reads a request body. Success answers 303 back to the panel so a
// plain HTML form works without JavaScript. The persistence layer removes the
// published-media membership inside the same transaction, so the article's
// images become private again atomically.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { authorizeMutation, unpublishPrivateDraft } from '../../../../../admin/editorial-session.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rejection = () => new Response('No se pudo despublicar el artículo', { status: 400, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    // 1. Authorize before anything else; no body is read at all.
    const cookie = request.headers.get('cookie');
    const requestOrigin = request.headers.get('origin');
    if (!await authorizeMutation(cookie, requestOrigin)) return rejection();
    // 2. Unpublish through the authorized service; a false or thrown outcome is
    //    the same generic rejection, without revealing which check failed.
    const { id } = await context.params;
    if (!await unpublishPrivateDraft(cookie ?? undefined, requestOrigin, id)) return rejection();
    return new Response(null, { status: 303, headers: { 'Cache-Control': 'no-store', 'Location': '/admin' } });
  } catch { return rejection(); }
}
