import { logoutCookie } from '../../../../lib/auth/boundary';

// Logout only has to prove the request came from the configured origin; it never
// needs credentials or storage, so it still works while the database is down.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = () => new Response('Login failed', { status: 400, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  try {
    const cookie = logoutCookie(process.env.AUTH_ORIGIN ?? '', request.headers.get('origin'));
    if (!cookie) return failure();
    return new Response(null, { status: 303, headers: { 'Cache-Control': 'no-store', 'Location': '/login', 'Set-Cookie': cookie } });
  } catch { return failure(); }
}
