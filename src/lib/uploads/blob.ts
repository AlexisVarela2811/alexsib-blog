import { randomBytes } from 'node:crypto';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { isValidImageUpload } from './validation.ts';

type Storage<T> = (pathname: string, body: Buffer, options: {
  access: 'private'; contentType: string; token: string; allowOverwrite: false;
}) => Promise<T>;

/**
 * Internal server-side primitive, not an endpoint. Callers must authorize first
 * and enforce the byte limit while reading the request. Private storage alone
 * does not implement media ownership or publication access checks. Signature
 * checks do not decode or scan images or guarantee that content is safe.
 * Pass @vercel/blob's put as the storage function in production.
 */
export async function storeImage<T>({ mime, bytes, token, put }: {
  mime: unknown; bytes: unknown; token: string | undefined; put: Storage<T>;
}): Promise<T> {
  if (!isValidImageUpload(mime, bytes)) throw new Error('Invalid image');
  if (typeof token !== 'string' || !token.trim()) throw new Error('Missing storage configuration');
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const contentType = mime as string;
  const pathname = `images/${randomBytes(16).toString('hex')}.${extensions[contentType]}`;
  return put(pathname, Buffer.from(bytes as Uint8Array), { access: 'private', contentType, token, allowOverwrite: false });
}
