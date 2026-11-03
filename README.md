# Alexsib Blog

A Spanish-language learning blog about programming and AI, designed as a dark terminal notebook. See [design.md](design.md) for the design direction.

## Current scope

The foundation provides a Next.js app, a minimal home page with an honest empty state, Tailwind styling, and CI checks. Articles, database storage and migrations, authentication, editing, and image uploads are planned, not implemented.

## Local setup

Use Node.js 24 and npm, then run:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No environment variables or production secrets are required for the current foundation.

## Checks

```sh
npm run test
npm run typecheck
npm run lint
npm run build
```

The test starts a local Next.js development server. `npm start` serves a completed production build.

## Hosting

Public hosting is not configured. Vercel is planned, but project creation, deployment, credentials, and any external provisioning require separate authorization. Database and storage setup will be documented when those integrations are implemented.
