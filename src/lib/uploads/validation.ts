// Default limit: 5 MiB of already-buffered input. Callers must enforce the same
// limit while reading a request, before allocating the complete upload.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Checks only the declared MIME, size and container signature. This is not
 * image decoding, malware scanning, authorization, or safe storage; corrupt
 * or malicious files can still pass. No input is written or modified.
 */
export function isValidImageUpload(mime: unknown, bytes: unknown): boolean {
  if (typeof window !== 'undefined' || !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return false;

  const startsWith = (signature: number[]) =>
    bytes.length >= signature.length && signature.every ( (value, index) => bytes[index] === value);

  if (mime === 'image/jpeg') return startsWith([0xff, 0xd8, 0xff]);
  if (mime === 'image/png') return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/webp') {
    if (bytes.length < 12 || !startsWith([0x52, 0x49, 0x46, 0x46]) ||
        bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return false;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    return size >= 4 && size === bytes.length - 8;
  }
  return false;
}
