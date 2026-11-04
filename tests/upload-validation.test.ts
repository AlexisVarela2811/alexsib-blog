import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { isValidImageUpload, MAX_IMAGE_BYTES } from '../src/lib/uploads/validation.ts';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test('accepts matching supported signatures', () => {
  for (const [mime, bytes] of [['image/jpeg', jpeg], ['image/png', png], ['image/webp', webp]] as const) {
    assert.equal(isValidImageUpload(mime, bytes), true);
  }
});

test('rejects unsupported, mismatched, truncated and malformed signatures', () => {
  for (const [mime, bytes] of [['image/gif', png], ['image/png', jpeg], ['image/webp', png], ['IMAGE/PNG', png], ['image/png', png.slice(0, 7)], ['image/jpeg', jpeg.slice(0, 2)], ['image/webp', webp.slice(0, 11)], ['image/webp', Uint8Array.from([...webp.slice(0, 4), 5, 0, 0, 0, ...webp.slice(8)])]] as const) {
    assert.equal(isValidImageUpload(mime, bytes), false);
  }
  assert.equal(isValidImageUpload(null, png), false);
  assert.equal(isValidImageUpload('image/png', null), false);
});

test('enforces the fixed byte limit without changing input', () => {
  const boundary = new Uint8Array(MAX_IMAGE_BYTES);
  boundary.set(png);
  assert.equal(isValidImageUpload('image/png', boundary), true);
  const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
  oversized.set(png);
  assert.equal(isValidImageUpload('image/png', oversized), false);
  assert.deepEqual(oversized.subarray(0, png.length), png);
});
