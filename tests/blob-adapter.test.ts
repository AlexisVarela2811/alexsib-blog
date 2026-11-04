import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { storeImage } from '../src/lib/uploads/blob.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { MAX_IMAGE_BYTES } from '../src/lib/uploads/validation.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test('rejects invalid type, signature and size before storage', async () => {
  let calls = 0;
  const put = async () => { calls++; return 'stored'; };
  const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1); oversized.set(png);
  for (const [mime, bytes] of [['image/gif', png], ['image/png', jpeg], ['image/png', new Uint8Array()], ['image/png', oversized]] as const) {
    await assert.rejects(storeImage({ mime, bytes, token: 'test', put }), /Invalid image/);
  }
  assert.equal(calls, 0);
});

test('stores supported images with safe unique names and explicit options', async () => {
  const names = new Set<string>();
  for (const [mime, bytes, extension] of [['image/png', png, 'png'], ['image/jpeg', jpeg, 'jpg'], ['image/webp', webp, 'webp']] as const) {
    const result = await storeImage({ mime, bytes, token: 'test', put: async (name, body, options) => {
      assert.match(name, new RegExp(`^images/[0-9a-f]{32}\\.${extension}$`));
      assert.deepEqual(body, Buffer.from(bytes));
      assert.deepEqual(options, { access: 'private', contentType: mime, token: 'test', allowOverwrite: false });
      assert.equal(names.has(name), false); names.add(name);
      return 'stored';
    } });
    assert.equal(result, 'stored');
  }
});

test('requires nonblank configuration and propagates storage errors', async () => {
  let calls = 0;
  const error = new Error('storage failure');
  const put = async () => { calls++; throw error; };
  for (const token of ['', '  ', undefined]) {
    await assert.rejects(storeImage({ mime: 'image/png', bytes: png, token, put }), /configuration/);
  }
  assert.equal(calls, 0);
  await assert.rejects(storeImage({ mime: 'image/png', bytes: png, token: 'test', put }), (err: unknown) => err === error);
  assert.equal(calls, 1);
});
