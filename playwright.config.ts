import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  outputDir: process.env.BROWSER_OUTPUT_DIR,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3197', browserName: 'chromium' },
  webServer: {
    command: 'node --experimental-strip-types scripts/browser-fixture.ts',
    url: 'http://127.0.0.1:3197',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 0 },
    timeout: 120_000,
  },
});
