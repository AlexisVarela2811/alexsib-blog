// Guarded save route for one private draft. Authorization is server-side and
// fail-closed: a mutation needs a valid `__Host-admin` session and the exact
// configured Origin header, exactly as the auth boundary provides it, and every
// failure — including storage and configuration errors — answers with the same
// generic rejection and no internal details.
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { savePrivateDraft } from '../../../../admin/editorial-session.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rejection = () => new Response('No se pudieron guardar los cambios', { status: 400, headers: { 'Cache-Control': 'no-store' } });
// Bounded body: a draft stores at most 200000 content characters plus metadata,
// and an unbounded body would be read into memory before any validation.
const maxBodyChars = 1_500_000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await request.text();
    if (body.length > maxBodyChars) return rejection();
    const saved = await savePrivateDraft(
      request.headers.get('cookie') ?? undefined,
      request.headers.get('origin'),
      id,
      JSON.parse(body),
    );
    if (!saved) return rejection();
    return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return rejection(); }
}
