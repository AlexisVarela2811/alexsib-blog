import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native Node TypeScript imports need an extension.
import { createAuthBoundary } from '../src/lib/auth/boundary.ts';

const origin = 'https://example.test';
function fixture() {
  const calls: string[] = [];
  let version = 'one';
  const boundary = createAuthBoundary({
    origin,
    consumeAttempt: async () => { calls.push('throttle'); return true; },
    verifyCredentials: async (user, password) => { calls.push('verify'); return user === 'admin' && password === 'password'; },
    createSession: async () => { calls.push('create'); return version; },
    verifySession: async token => { calls.push('session'); return token === version; },
  });
  return { boundary, calls, rotate: () => { version = 'two'; } };
}

test('throttles before verification including malformed inputs and fails closed on dependency failures', async () => {
  const { boundary, calls } = fixture();
  assert.equal(await boundary.login(null, null, origin), null);
  assert.deepEqual(calls, ['throttle']);
  assert.equal(await boundary.login('wrong', 'password', origin), null);
  assert.deepEqual(calls, ['throttle', 'throttle', 'verify']);
  for (const consumeAttempt of [async () => false, async () => { throw Error(); }]) {
    const b = createAuthBoundary({ origin, consumeAttempt, verifyCredentials: async () => { throw Error('must not run'); }, createSession: async () => 'x', verifySession: async () => true });
    assert.equal(await b.login('admin', 'password', origin), null);
  }
  for (const failing of ['verifyCredentials', 'createSession'] as const) {
    const b = createAuthBoundary({ origin, consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'x', verifySession: async () => true, [failing]: async () => { throw Error(); } });
    assert.equal(await b.login('admin', 'password', origin), null);
  }
});

test('issues and clears a bounded secure host cookie and rejects unsafe tokens', async () => {
  const { boundary } = fixture();
  assert.equal(await boundary.login('admin', 'password', origin), '__Host-admin=one; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict');
  assert.equal(boundary.logout(origin), '__Host-admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
  const b = createAuthBoundary({ origin, consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'bad; token', verifySession: async () => true });
  assert.equal(await b.login('admin', 'password', origin), null);
});

test('rejects login and logout without the exact origin before calling dependencies', async () => {
  const { boundary, calls } = fixture();
  for (const untrusted of [undefined, null, 'null', 'https://example.test.evil', 'http://example.test']) {
    assert.equal(await boundary.login('admin', 'password', untrusted), null);
    assert.equal(boundary.logout(untrusted), null);
    assert.deepEqual(calls, []);
  }
  assert.equal(await boundary.login('admin', 'password', origin), '__Host-admin=one; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Strict');
  assert.deepEqual(calls, ['throttle', 'verify', 'create']);
  assert.equal(boundary.logout(origin), '__Host-admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
  assert.deepEqual(calls, ['throttle', 'verify', 'create']);
});

test('read authorization validates one session without requiring an origin', async () => {
  const { boundary, rotate } = fixture();
  assert.equal(await boundary.authorizeRead('other=x; __Host-admin=one'), true);
  for (const cookie of [undefined, null, '', '__Host-admin=', '__Host-admin=one; __Host-admin=one', '__Host-admin=bad%3Bone', 'x'.repeat(8193)]) {
    assert.equal(await boundary.authorizeRead(cookie), false);
  }
  rotate();
  assert.equal(await boundary.authorizeRead('__Host-admin=one'), false);
  const deps = { origin, consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'x', verifySession: async () => { throw Error('private'); } };
  assert.equal(await createAuthBoundary(deps).authorizeRead('__Host-admin=x'), false);
  assert.equal(await createAuthBoundary({ ...deps, origin: 'http://example.test', verifySession: async () => true }).authorizeRead('__Host-admin=x'), false);
});

test('requires an exact trusted origin and valid session for mutations; rotation invalidates old sessions', async () => {
  const { boundary, rotate } = fixture();
  assert.equal(await boundary.authorize('__Host-admin=one', origin), true);
  for (const untrusted of [null, 'null', 'https://example.test.evil', 'http://example.test']) assert.equal(await boundary.authorize('__Host-admin=one', untrusted), false);
  for (const cookie of [null, '__Host-admin=one; __Host-admin=one', '__Host-admin=bad%3Bone', '__Host-admin=']) assert.equal(await boundary.authorize(cookie, origin), false);
  rotate();
  assert.equal(await boundary.authorize('__Host-admin=one', origin), false);
  assert.equal(await boundary.authorize('__Host-admin=two', origin), true);
  const b = createAuthBoundary({ origin: 'http://example.test', consumeAttempt: async () => true, verifyCredentials: async () => true, createSession: async () => 'x', verifySession: async () => { throw Error(); } });
  assert.equal(await b.authorize('__Host-admin=x', 'http://example.test'), false);
  assert.equal(await b.login('admin', 'password', origin), null);
  assert.equal(b.logout('http://example.test'), null);
});
