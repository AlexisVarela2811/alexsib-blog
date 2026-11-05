import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { createEditorialService } from '../src/lib/editorial/service.ts';

const input = { slug: 'hello', title: 'Hello', excerpt: 'Excerpt', content: 'Content', tags: [], coverImage: null };
const article = { ...input, id: 'one', status: 'draft' as const, createdAt: 'now', updatedAt: 'now', publishedAt: null };

test('every operation authorizes before accessing persistence and delegates arguments', async () => {
  const calls: unknown[][] = [];
  const service = createEditorialService({
    authorizeRead: async () => { calls.push(['read auth']); return true; },
    authorizeMutation: async () => { calls.push(['mutation auth']); return true; },
    persistence: {
      list: async () => { calls.push(['list']); return [article]; },
      read: async id => { calls.push(['read', id]); return article; },
      create: async value => { calls.push(['create', value]); return article; },
      edit: async (id, value) => { calls.push(['edit', id, value]); return article; },
      publish: async id => { calls.push(['publish', id]); return article; },
      unpublish: async id => { calls.push(['unpublish', id]); return article; },
    },
  });
  assert.deepEqual(await service.list(), [article]);
  assert.deepEqual(await service.read('one'), article);
  assert.deepEqual(await service.create(input), article);
  assert.deepEqual(await service.edit('one', input), article);
  assert.deepEqual(await service.publish('one'), article);
  assert.deepEqual(await service.unpublish('one'), article);
  assert.deepEqual(calls, [['read auth'], ['list'], ['read auth'], ['read', 'one'], ['mutation auth'], ['create', input], ['mutation auth'], ['edit', 'one', input], ['mutation auth'], ['publish', 'one'], ['mutation auth'], ['unpublish', 'one']]);
});

test('denial, non-true results and authorization exceptions never access data or leak details', async () => {
  for (const outcome of [false, undefined, 'true', new Error('private token')]) {
    let accesses = 0;
    const authorize = async () => { if (outcome instanceof Error) throw outcome; return outcome as boolean; };
    const denied = async () => { accesses++; throw new Error('private persistence'); };
    const service = createEditorialService({ authorizeRead: authorize, authorizeMutation: authorize, persistence: { list: denied, read: denied, create: denied, edit: denied, publish: denied, unpublish: denied } });
    for (const operation of [() => service.list(), () => service.read('one'), () => service.create(input), () => service.edit('one', input), () => service.publish('one'), () => service.unpublish('one')]) {
      await assert.rejects(operation, { message: 'Unauthorized' });
    }
    assert.equal(accesses, 0);
  }
});

test('persistence errors are sanitized for every operation', async () => {
  const fail = async () => { throw new Error('private database details'); };
  const service = createEditorialService({ authorizeRead: async () => true, authorizeMutation: async () => true, persistence: { list: fail, read: fail, create: fail, edit: fail, publish: fail, unpublish: fail } });
  for (const operation of [() => service.list(), () => service.read('one'), () => service.create(input), () => service.edit('one', input), () => service.publish('one'), () => service.unpublish('one')]) {
    await assert.rejects(operation, { message: 'Editorial operation failed' });
  }
});
