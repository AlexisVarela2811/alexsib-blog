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

Open http://localhost:3000. Git ignores `local.sqlite`. By default, the migration accepts only explicit `file:` URLs; remote bootstrap requires the separate opt-in described below. Do not use an existing database for this step. Without `TURSO_DATABASE_URL`, queries report a configuration error; no remote database is selected automatically. `SITE_URL` must be the real public origin for sitemap and robots generation.

For Turso at runtime, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the server environment. Never commit credentials. Vercel requires both variables and `SITE_URL`.

To bootstrap an explicitly selected, empty Turso database, first verify the target and prepare a recovery plan. Set the remote `libsql://` URL and token in your shell, then run `npm run db:migrate -- --remote`. The remote mode rejects nonempty databases, URL options and embedded credentials; it does not seed content. If the connection fails during commit, the outcome may be unknown: inspect the target before deciding what to do, and do not blindly retry. Remote provider behavior has not yet been verified by this project.

Optionally, after migrating an explicit local file database, run `npm run db:seed` to add a published beginner-friendly example about context windows. This is never run automatically, rejects missing or nonlocal database URLs, and leaves an existing post with the example slug unchanged on repeated runs or conflicts. It does not enable login or private endpoints.

Published articles are read from SQLite; drafts are not public. Articles use the shared Markdown renderer, which omits raw HTML. An empty fenced code block marked `context-window` embeds the interactive context-window illustration.

## Private panel

With the authentication values from the next section and `BLOB_READ_WRITE_TOKEN` for private image storage, a signed-in admin can list drafts and published articles, edit and preview one draft, upload images (JPEG, PNG or WebP up to 5 MiB), publish and unpublish. Every one of those routes is a guarded server-side handler: pages redirect to `/login` without a valid `__Host-admin` session, and mutations additionally require the exact configured `Origin`, answer one generic rejection with `Cache-Control: no-store`, and never return internal detail. Draft images are served only to that session; publishing makes an article and its images readable by anyone through `/media/<id>`, and unpublishing takes both back.

Known limits, by design for this MVP: an edit overwrites the draft in place, with no revision history; an image that a shared cache already stored may stay readable for up to 60 seconds after unpublishing; a draft carrying a legacy `https://` cover image cannot be published until that cover is replaced, because publishing only accepts blog-managed images; a double submit shows the generic rejection instead of returning to the panel; and there is no background worker that retries an upload whose provider outcome was ambiguous, so such an intent stays recorded for manual reconciliation. Nothing here proves real provider behaviour: Vercel Blob uploads, Turso across multiple clients, session revocation freshness and a full browser run remain unverified by this project.

## Private login

`POST /api/auth/login` accepts a urlencoded `username` and `password`, requires an `Origin` header equal to `AUTH_ORIGIN`, and answers with the generic body `Login failed` (400, `Cache-Control: no-store`, no cookie) for every rejection. On success it returns 303 to `/admin` and sets `__Host-admin`, an HS256 JWT valid for 8 hours, `Secure; HttpOnly; SameSite=Strict`. Configuration comes only from the server environment:

| Variable | Value |
| --- | --- |
| `AUTH_ORIGIN` | Exact public HTTPS origin, with no path, query or credentials |
| `AUTH_USERNAME` | Admin user, at most 128 UTF-8 bytes |
| `AUTH_PASSWORD_HASH` | `scrypt$<salt>$<key>`: canonical padded base64 of a random 16-byte salt and a 32-byte key derived with `scrypt N=32768, r=8, p=1, maxmem=64 MiB` |
| `AUTH_SESSION_SECRET` | Canonical padded base64 of 32 cryptographically random bytes |

Generate both secrets with a cryptographically secure source; length and format checks cannot prove entropy. Never commit them. Rotating the password requires rotating `AUTH_SESSION_SECRET`, which invalidates every existing session; there is no revocation list, so a copied token stays valid until it expires or the key rotates. Login requires the `login_throttle` table from the ordinary migration; a missing table, an unreachable database or any malformed value rejects every attempt. Session invalidation policy: there is no revocation list, so a copied token stays valid until it expires (at most 8 hours) or the signing key changes. Rotating `AUTH_SESSION_SECRET` invalidates every existing session immediately, and rotating the password is only complete when the secret is rotated in the same change; the tested rotation behaviour is that a token signed with a previous secret is rejected on every guarded route. Logout clears the cookie in the browser but does not revoke a token that was already copied elsewhere.

## Checks

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

The tests create isolated temporary databases and start a local server. The last reported audit found 20 moderate vulnerabilities in development dependencies (ESLint/minimatch and Drizzle Kit/esbuild); `npm audit --omit=dev` reported no production vulnerabilities. This is not a general security guarantee. Do not expose development tools to the public network; esbuild install scripts remain unapproved.

The end-to-end login and panel checks spawn real Next servers, so they are skipped by default. Copy the project to an isolated directory with its own `node_modules`, place that copy on a normal filesystem rather than `/tmp`, and opt in explicitly:

```sh
AUTH_HTTP_ISOLATED=1 node --experimental-strip-types --test --test-concurrency=1 tests/auth-login-route.test.ts tests/auth-admin-route.test.ts
```

Turbopack cannot start its node process pool from a tmpfs copy, where `/login` fails with a 500 before any assertion runs, and Next allows only one development server per project directory, so those files must not run concurrently. The copy must contain no private files.

## Browser checks

Install Chromium locally when authorized, then run the checks:

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright ./node_modules/.bin/playwright install chromium
npm run test:browser
```

The checks start one local Next server with a fresh migrated SQLite fixture and clear the auth token; they never use `local.sqlite`. The runner attempts to remove its fixture and server afterward, but cleanup on failure has not been independently verified. Port 3197 must be free. Full-page screenshots are saved to `test-results/desktop-home.png`, `test-results/mobile-home.png`, and `test-results/desktop-article.png`. These are inspection artifacts, not pixel-diff baselines.
