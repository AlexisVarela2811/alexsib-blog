# Alexsib Blog

A Spanish-language notebook about programming and artificial intelligence. See [design.md](design.md) for the visual direction.

## Local development

With Node.js 24 and npm, install dependencies with `npm ci`. To create a new local database:

```sh
export TURSO_DATABASE_URL=file:local.sqlite
export SITE_URL=http://localhost:3000
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Git ignores `local.sqlite`. The initial migration accepts only explicit `file:` URLs; it does not migrate remote or production databases. Do not use an existing database for this step. Without `TURSO_DATABASE_URL`, queries report a configuration error; no remote database is selected automatically. `SITE_URL` must be the real public origin for sitemap and robots generation.

For Turso at runtime, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the server environment. Never commit credentials. Vercel requires both variables and `SITE_URL`, plus a database provisioned and migrated through a separately authorized procedure. No resources have been provisioned or deployed.

Published articles are read from SQLite; drafts are not public. Articles use the shared Markdown renderer, which omits raw HTML. An empty fenced code block marked `context-window` embeds the interactive context-window illustration. The editor is not yet connected to a private publishing workflow; authentication and image uploads are not implemented.

## Checks

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

The tests create isolated temporary databases and start a local server. The last reported audit found 20 moderate vulnerabilities in development dependencies (ESLint/minimatch and Drizzle Kit/esbuild); `npm audit --omit=dev` reported no production vulnerabilities. This is not a general security guarantee. Do not expose development tools to the public network; esbuild install scripts remain unapproved.

## Browser checks

Install Chromium locally when authorized, then run the checks:

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright ./node_modules/.bin/playwright install chromium
npm run test:browser
```

The checks start one local Next server with a fresh migrated SQLite fixture and clear the auth token; they never use `local.sqlite`. The runner attempts to remove its fixture and server afterward, but cleanup on failure has not been independently verified. Port 3197 must be free. Full-page screenshots are saved to `test-results/desktop-home.png`, `test-results/mobile-home.png`, and `test-results/desktop-article.png`. These are inspection artifacts, not pixel-diff baselines.
