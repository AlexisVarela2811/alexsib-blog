import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
// @ts-expect-error Node requires explicit extensions.
import { createIntent, findIntent, transitionIntent, registerIntent } from '../src/lib/uploads/intent.ts';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { uploadWithIntent, IntentUploadError } from '../src/lib/uploads/intent-upload.ts';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const stream = () => (async function* () { yield png; })();
type Intent = { operationId: string; mediaId: string; postId: string; storagePath: string; state: 'prepared' | 'uploaded' | 'registered' };
function fixture() {
  const calls: string[] = [];
  let row: Intent | null = null;
  const deps = {
    authorize: async () => { calls.push('authorize'); return true; },
    create: async (input: Omit<Intent, 'state'>) => { calls.push('create'); row = { ...input, state: 'prepared' }; return row; },
    find: async () => { calls.push('find'); return row; },
    put: async (path: string, bytes: Buffer, options: unknown) => { calls.push('put'); assert.equal(path, row?.storagePath); assert.deepEqual(bytes, Buffer.from(png)); assert.deepEqual(options, { access: 'private', contentType: 'image/png', token: 'test', allowOverwrite: false }); return { pathname: 'untrusted' }; },
    transition: async () => { calls.push('transition'); row = { ...row!, state: 'uploaded' }; return row; },
    register: async () => { calls.push('register'); row = { ...row!, state: 'registered' }; return row; },
  };
  return { calls, deps, getRow: () => row };
}
const input = () => ({ postId: 'draft', mime: 'image/png', token: 'test', stream: stream() });

test('reserves server identities before private put and registers only after transition', async () => {
  const f = fixture(); const result = await uploadWithIntent(input(), f.deps);
  assert.deepEqual(f.calls, ['authorize', 'create', 'put', 'transition', 'register']);
  assert.equal(result.id, f.getRow()?.mediaId);
  assert.match(f.getRow()!.storagePath, /^images\/[0-9a-f]{32}\.png$/);
  assert.match(f.getRow()!.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(f.getRow()?.state, 'registered');
});

test('authorization precedes reading and validation rejects before durable writes', async () => {
  const f = fixture(); let read = false;
  f.deps.authorize = async () => false;
  await assert.rejects(uploadWithIntent({ ...input(), stream: (async function* () { read = true; yield png; })() }, f.deps), /Unauthorized/);
  assert.equal(read, false); assert.equal(f.getRow(), null);
  f.deps.authorize = async () => true;
  for (const bad of [{ ...input(), mime: 'image/gif' }, { ...input(), token: '' }, { ...input(), stream: (async function* () { yield new Uint8Array(5 * 1024 * 1024 + 1); })() }]) {
    await assert.rejects(uploadWithIntent(bad, f.deps));
  }
  assert.equal(f.getRow(), null); assert.deepEqual(f.calls, []);
});

test('ambiguous create requires a matching prepared readback before put', async () => {
  const f = fixture(); const create = f.deps.create;
  f.deps.create = async value => { await create(value); throw new Error('uncertain'); };
  await uploadWithIntent(input(), f.deps);
  assert.deepEqual(f.calls, ['authorize', 'create', 'find', 'put', 'transition', 'register']);
  const g = fixture(); g.deps.create = async () => { throw new Error('uncertain'); };
  await assert.rejects(uploadWithIntent(input(), g.deps), IntentUploadError);
  assert.deepEqual(g.calls, ['authorize', 'find']);
});

test('ambiguous put never advances, retries or registers', async () => {
  const f = fixture(); f.deps.put = async () => { f.calls.push('put'); throw new Error('uncertain'); };
  await assert.rejects(uploadWithIntent(input(), f.deps), IntentUploadError);
  assert.deepEqual(f.calls, ['authorize', 'create', 'put']); assert.equal(f.getRow()?.state, 'prepared');
});

test('ambiguous transition and registration remain unresolved without matching durable proof', async () => {
  const f = fixture(); f.deps.transition = async () => { f.calls.push('transition'); throw new Error('uncertain'); };
  await assert.rejects(uploadWithIntent(input(), f.deps), IntentUploadError);
  assert.equal(f.getRow()?.state, 'prepared'); assert.equal(f.calls.includes('register'), false);
  const g = fixture(); g.deps.register = async () => { g.calls.push('register'); throw new Error('uncertain'); };
  await assert.rejects(uploadWithIntent(input(), g.deps), IntentUploadError);
  assert.equal(g.getRow()?.state, 'uploaded');
});

test('failed creation never puts on mismatched or unavailable readback', async () => {
  for (const field of ['operationId', 'mediaId', 'postId', 'storagePath', 'state', 'unavailable'] as const) {
    const f = fixture(); const create = f.deps.create; const find = f.deps.find;
    f.deps.create = async value => { await create(value); throw new Error('lost'); };
    f.deps.find = async () => {
      const row = await find();
      if (field === 'unavailable') throw new Error('unavailable');
      return { ...row!, [field]: field === 'state' ? 'uploaded' : 'different' };
    };
    await assert.rejects(uploadWithIntent(input(), f.deps), (error: unknown) => error instanceof IntentUploadError && error.operation === 'create');
    assert.deepEqual(f.calls, ['authorize', 'create', 'find']);
    assert.equal(f.getRow()?.state, 'prepared');
  }
});

test('mismatched successful transition and registration responses remain unresolved', async () => {
  for (const operation of ['transition', 'register'] as const) {
    for (const field of ['operationId', 'mediaId', 'postId', 'storagePath', 'state'] as const) {
      const f = fixture();
      const original = f.deps[operation];
      const deps = { ...f.deps, delete: async () => { f.calls.push('delete'); } };
      deps[operation] = async () => {
        const row = await original();
        return { ...row, [field]: field === 'state' ? 'prepared' : 'different' };
      };
      await assert.rejects(uploadWithIntent(input(), deps), (error: unknown) => {
        assert.ok(error instanceof IntentUploadError);
        assert.equal(error.operation, operation);
        assert.equal(error.message, 'Upload requires reconciliation');
        const row = f.getRow()!;
        assert.deepEqual(error.identity, { operationId: row.operationId, mediaId: row.mediaId, postId: row.postId, storagePath: row.storagePath });
        return true;
      }, `${operation}: ${field}`);
      assert.deepEqual(f.calls, operation === 'transition'
        ? ['authorize', 'create', 'put', 'transition']
        : ['authorize', 'create', 'put', 'transition', 'register'], `${operation}: ${field}`);
      // Registration may have committed even though its response cannot be trusted.
      assert.equal(f.getRow()?.state, operation === 'transition' ? 'uploaded' : 'registered');
    }
  }
});

test('provider response pathname is not used as registration authority', async () => {
  const f = fixture();
  let supplied = '';
  const original = f.deps.put;
  f.deps.put = async (path, bytes, options) => { supplied = path; return original(path, bytes, options); };
  const result = await uploadWithIntent(input(), f.deps);
  assert.equal(result.id, f.getRow()?.mediaId);
  assert.equal(f.getRow()?.storagePath, supplied);
  assert.notEqual(f.getRow()?.storagePath, 'untrusted');
  assert.deepEqual(f.calls, ['authorize', 'create', 'put', 'transition', 'register']);
});

test('actual intent persistence handles failed and lost responses without unsafe follow-on work', async () => {
  for (const scenario of ['success', 'create-before', 'create-after', 'put-before', 'put-after', 'transition-before', 'transition-after', 'register-before', 'register-after'] as const) {
    const client = createClient({ url: ':memory:' });
    try {
      for (const file of ['0000_initial.sql', '0002_media.sql', '0003_upload_intent.sql', '0004_upload_reservations.sql']) await client.executeMultiple(readFileSync(`drizzle/${file}`, 'utf8'));
      await client.execute("INSERT INTO posts (id,slug,title,excerpt,content,tags,status,created_at,updated_at) VALUES ('draft','draft','t','e','c','[]','draft','now','now')");
      const db = drizzle(client);
      const calls: string[] = [];
      let reserved: Omit<Intent, 'state'> | undefined;
      const stored = new Map<string, Buffer>();
      const deps = {
        authorize: async () => { calls.push('authorize'); return true; },
        create: async (value: Omit<Intent, 'state'>) => {
          calls.push('create'); reserved = value;
          if (scenario === 'create-before') throw new Error('before create');
          const row = await createIntent(db, value);
          if (scenario === 'create-after') throw new Error('lost create');
          return row;
        },
        find: async (id: string) => { calls.push('find'); return findIntent(db, id); },
        put: async (path: string, bytes: Buffer, options: { access: 'private'; contentType: string; token: string; allowOverwrite: false }) => {
          calls.push('put'); assert.equal(path, reserved?.storagePath);
          assert.deepEqual(options, { access: 'private', contentType: 'image/png', token: 'test', allowOverwrite: false });
          if (scenario === 'put-before') throw new Error('before put');
          stored.set(path, bytes);
          if (scenario === 'put-after') throw new Error('lost put');
          return { pathname: 'untrusted' };
        },
        transition: async (id: string, from: 'prepared', to: 'uploaded') => {
          calls.push('transition');
          if (scenario === 'transition-before') throw new Error('before transition');
          const row = await transitionIntent(db, id, from, to);
          if (scenario === 'transition-after') throw new Error('lost transition');
          return row;
        },
        register: async (id: string) => {
          calls.push('register');
          if (scenario === 'register-before') throw new Error('before register');
          const row = await registerIntent(db, id);
          if (scenario === 'register-after') throw new Error('lost register');
          return row;
        },
        delete: async () => { calls.push('delete'); },
      };
      if (scenario === 'success' || scenario === 'create-after') {
        const result = await uploadWithIntent(input(), deps);
        assert.equal(result.id, reserved?.mediaId);
      } else {
        await assert.rejects(uploadWithIntent(input(), deps), (error: unknown) => error instanceof IntentUploadError && error.operation === scenario.split('-')[0]);
      }
      const row = await findIntent(db, reserved!.operationId);
      const media = (await client.execute('SELECT id, post_id, storage_path FROM media')).rows;
      const expectedState = scenario === 'create-before' ? undefined : scenario.startsWith('put-') || scenario === 'transition-before' ? 'prepared' : scenario === 'transition-after' || scenario === 'register-before' ? 'uploaded' : 'registered';
      assert.equal(row?.state, expectedState, scenario);
      assert.equal(media.length, expectedState === 'registered' ? 1 : 0, scenario);
      if (media.length) { assert.equal(media[0].id, reserved?.mediaId); assert.equal(media[0].storage_path, reserved?.storagePath); }
      assert.equal(stored.size, ['create-before', 'put-before'].includes(scenario) ? 0 : 1, scenario);
      if (stored.size) assert.deepEqual(stored.get(reserved!.storagePath), Buffer.from(png));
      assert.equal(calls.includes('delete'), false, scenario);
      assert.equal(calls.filter(call => call === 'put').length, scenario === 'create-before' ? 0 : 1, scenario);
      assert.equal(calls.includes('transition'), !['create-before', 'put-before', 'put-after'].includes(scenario), scenario);
      assert.equal(calls.includes('register'), !['create-before', 'put-before', 'put-after', 'transition-before', 'transition-after'].includes(scenario), scenario);
    } finally { client.close(); }
  }
});
