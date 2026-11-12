// GET /media/<id>. The handler only maps the dynamic segment and the raw Cookie
// header onto the per-request media delivery composition; all authorization,
// id bounding, content-type and cache policy live in ./delivery.ts. Every
// failure — including configuration and storage errors — is the same empty 404.
import { get } from '@vercel/blob';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { serveMedia } from '../delivery.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per-request composition from server-only environment values. */
function deliveryDependencies() {
  return {
    databaseUrl: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    origin: process.env.AUTH_ORIGIN,
    username: process.env.AUTH_USERNAME,
    passwordHash: process.env.AUTH_PASSWORD_HASH,
    sessionSecret: process.env.AUTH_SESSION_SECRET,
    blobGet: get,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return await serveMedia(deliveryDependencies(), id, request.headers.get('cookie'));
  } catch { return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
}
