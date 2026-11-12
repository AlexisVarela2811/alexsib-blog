import { createDatabase } from '../../../../db/client';
import { createAuthComposition } from '../../../../lib/auth/composition';
import { loginHttp } from '../../../../lib/auth/login-http';

// Server-only route: the composition validates every configuration value and fails
// closed on missing, malformed or unreachable storage before any credential is read.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = () => new Response('Login failed', { status: 400, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  try {
    const { client } = createDatabase();
    try {
      const auth = createAuthComposition({
        origin: process.env.AUTH_ORIGIN,
        username: process.env.AUTH_USERNAME,
        passwordHash: process.env.AUTH_PASSWORD_HASH,
        sessionSecret: process.env.AUTH_SESSION_SECRET,
      }, client);
      return await loginHttp(request, auth);
    } finally { client.close(); }
  } catch { return failure(); }
}
