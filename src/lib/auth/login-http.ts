import type { createAuthComposition } from './composition';

type Auth = Pick<ReturnType<typeof createAuthComposition>, 'login'>;
const maxBodyBytes = 4096;
const failure = () => new Response('Login failed', { status: 400, headers: { 'Cache-Control': 'no-store' } });

/** Disconnected server-side adapter; no route is enabled by this module. */
export async function loginHttp(request: Request, auth: Auth): Promise<Response> {
  try {
    if (typeof window !== 'undefined' || request.method !== 'POST' ||
        !/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('content-type') ?? '') || !request.body) return failure();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) { void reader.cancel().catch(() => {}); return failure(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const fields = new Map<string, string>();
    for (const pair of raw.split('&')) {
      const index = pair.indexOf('=');
      const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
      const key = decode(index < 0 ? pair : pair.slice(0, index));
      const value = decode(index < 0 ? '' : pair.slice(index + 1));
      if ((key === 'username' || key === 'password') && fields.has(key)) return failure();
      fields.set(key, value);
    }
    if (!fields.has('username') || !fields.has('password')) return failure();
    const cookie = await auth.login(fields.get('username'), fields.get('password'), request.headers.get('origin'));
    if (!cookie) return failure();
    return new Response(null, { status: 303, headers: { 'Cache-Control': 'no-store', 'Location': '/admin', 'Set-Cookie': cookie } });
  } catch { return failure(); }
}
