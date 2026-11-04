import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

const root = process.cwd();
const id = randomUUID();
const results = join(root, 'test-results');
const fixture = join(results, `browser-db-${id}`);
const output = join(results, `browser-output-${id}`);
mkdirSync(results, { recursive: true });
const portOpen = () => new Promise<boolean>(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port: 3197 });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
const occupiedBefore = await portOpen();
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(root, '.playwright'), BROWSER_FIXTURE_DIR: fixture, BROWSER_OUTPUT_DIR: output },
});
const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
rmSync(output, { recursive: true, force: true });
let failed = false;
if (existsSync(fixture)) {
  console.error(`Browser fixture was not cleaned up: ${fixture}`);
  failed = true;
}
if (!occupiedBefore && await portOpen()) {
  console.error('Browser server still accepts connections on 127.0.0.1:3197');
  failed = true;
}
if (result.signal) {
  console.error(`Playwright terminated by ${result.signal}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.code || (failed ? 1 : 0);
}
