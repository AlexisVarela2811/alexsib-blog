import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

let server: ChildProcess;
let baseUrl: string;

before(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('No port'));
      listener.close(() => resolve(address.port));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next exited with ${server.exitCode}`);
    try {
      await fetch(baseUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('Next did not start');
});

after(() => server?.kill());

test('home presents the Spanish blog introduction and honest empty state', async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Alexsib Blog/);
  assert.match(html, /Aprender explicando/);
  assert.match(html, /Aún no hay artículos publicados/);
  assert.match(html, /href="#articulos"/);
  assert.match(html, /lang="es"/);
});
