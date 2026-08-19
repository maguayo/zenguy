# Zenguy API

The API is a Hono application running on Cloudflare Workers. Local development requires Node.js 22 or newer, pnpm, and an authenticated Wrangler installation for remote Cloudflare resources.

## Run locally

```sh
pnpm install
pnpm --filter @zenguy/api db:migrate:local
pnpm --filter @zenguy/api dev
```

Run Browser Rendering-dependent flows with `pnpm --filter @zenguy/api dev:remote`.

## Test

```sh
pnpm --filter @zenguy/api typecheck
pnpm --filter @zenguy/api test
pnpm --filter @zenguy/api test:integration
```

## R2 lifecycle safety net

The cleanup cron purges operational data after 30 days. Configure a second R2
lifecycle guard that expires every object in `zenguy-artifacts` after 35 days:

<!-- pnpm --filter @zenguy/api exec wrangler r2 bucket lifecycle add zenguy-artifacts retention-safety-net --expire-days 35 -->
