/* eslint-disable @typescript-eslint/no-require-imports -- This diagnostic runs directly as CommonJS. */
const { loadEnvConfig } = require('@next/env');
const { randomUUID } = require('node:crypto');

loadEnvConfig(process.cwd());

async function main() {
  const { put, del } = await import('@vercel/blob');
  const path = `connection-test/${randomUUID()}.txt`;
  let uploaded = false;
  let failed = false;
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Missing configuration');
    const blob = await put(path, 'private-test', {
      access: 'private', allowOverwrite: false, contentType: 'text/plain',
    });
    uploaded = true;
    const response = await fetch(blob.url, { redirect: 'manual', cache: 'no-store' });
    if (![401, 403, 404].includes(response.status)) {
      console.error(`Anonymous access: unexpected HTTP ${response.status}`);
      failed = true;
    } else {
      console.log(`Anonymous access denied: HTTP ${response.status}`);
    }
  } catch {
    console.error(`Blob privacy check failed; if upload outcome was uncertain, inspect ${path}`);
    failed = true;
  } finally {
    if (uploaded) {
      try { await del(path); console.log('Temporary object deleted'); }
      catch { console.error(`Temporary object cleanup failed; inspect ${path}`); failed = true; }
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(() => { console.error('Blob privacy check could not start'); process.exitCode = 1; });
