import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { uploadImage, UploadReconciliationError } from '../src/lib/uploads/service.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { MAX_IMAGE_BYTES } from '../src/lib/uploads/validation.ts';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function setup() {
  const calls: string[] = [];
  const deps = {
    authorize: async () => true,
    put: async (path: string, _body: Buffer, options: { access: 'private'; contentType: string; token: string; allowOverwrite: false }) => { calls.push(`put:${path}:${options.access}`); return {}; },
    register: async (_post: string, _id: string, path: string) => { calls.push(`register:${path}`); },
    remove: async (path: string) => { calls.push(`remove:${path}`); },
  };
  return { calls, deps };
}
function stream(bytes: Uint8Array) { return (async function* () { yield bytes; })(); }
const input = (bytes: Uint8Array) => ({ postId: 'draft', mime: 'image/png', token: 'token', stream: stream(bytes) });

test('stores privately and registers the generated path', async () => {
  const { calls, deps } = setup();
  const result = await uploadImage(input(png), deps);
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(result), ['id']);
  assert.match(calls[0], /^put:images\/[0-9a-f]{32}\.png:private$/);
  assert.equal(calls[1], `register:${calls[0].slice(4, -8)}`);
});

test('authorization precedes consuming the stream', async () => {
  const { calls, deps } = setup();
  deps.authorize = async () => false;
  let read = false;
  const source = (async function* () { read = true; yield png; })();
  await assert.rejects(uploadImage({ ...input(png), stream: source }, deps), /Unauthorized/);
  assert.equal(read, false); assert.deepEqual(calls, []);
});

test('accepts the actual size boundary and rejects larger streams', async () => {
  const { calls, deps } = setup();
  const boundary = Buffer.alloc(MAX_IMAGE_BYTES); png.copy(boundary);
  await uploadImage(input(boundary), deps);
  calls.length = 0;
  const source = (async function* () { yield boundary; yield Buffer.from([0]); })();
  await assert.rejects(uploadImage({ ...input(png), stream: source }, deps), /too large/);
  assert.deepEqual(calls, []);
});

test('rejects invalid signatures before storage', async () => {
  const { calls, deps } = setup();
  await assert.rejects(uploadImage(input(Buffer.from('bad')), deps), /Invalid image/);
  assert.deepEqual(calls, []);
});

test('persisted upload followed by lost response exposes uncertain storage for reconciliation', async () => {
  const { calls, deps } = setup();
  let persisted = '';
  const cause = new Error('response lost');
  deps.put = async (path) => { calls.push(`put:${path}`); persisted = path; throw cause; };
  await assert.rejects(uploadImage(input(png), deps), (error: unknown) => {
    assert.ok(error instanceof UploadReconciliationError);
    assert.deepEqual(error.reconciliation, { operation: 'put', outcome: 'uncertain', postId: 'draft', storagePath: persisted });
    assert.equal(error.cause, cause);
    return true;
  });
  assert.match(persisted, /^images\/[0-9a-f]{32}\.png$/);
  assert.deepEqual(calls, [`put:${persisted}`]);
});

test('committed registration followed by lost response never deletes and exposes reconciliation details', async () => {
  const { calls, deps } = setup();
  let committed: { postId: string; id: string; storagePath: string } | undefined;
  const cause = new Error('response lost');
  deps.register = async (postId, id, storagePath) => { calls.push(`register:${storagePath}`); committed = { postId, id, storagePath }; throw cause; };
  await assert.rejects(uploadImage(input(png), deps), (error: unknown) => {
    assert.ok(error instanceof UploadReconciliationError);
    assert.ok(committed);
    assert.deepEqual(error.reconciliation, { operation: 'register', outcome: 'uncertain', ...committed });
    assert.equal(error.cause, cause);
    return true;
  });
  assert.ok(committed);
  assert.match(committed.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls, [`put:${committed.storagePath}:private`, `register:${committed.storagePath}`]);
});
