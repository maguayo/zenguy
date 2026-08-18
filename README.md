# Zenguy

Zenguy is a multi-tenant SaaS for natural-language browser testing and HTTP uptime monitoring, built as a Cloudflare-first monorepo with a Hono API, React application, and Astro landing site.

```text
zenguy/
├── apps/
│   ├── api/      # Cloudflare Worker API, queues, crons, and storage adapters
│   ├── web/      # React application
│   └── landing/  # Astro landing site
├── PROJECT.md
├── TASKS_BACKEND.md
└── TASKS_FRONTEND.md
```

See `apps/api/README.md` / `apps/web/README.md` to run each app.
