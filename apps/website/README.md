# @zenguy/website

Public marketing site for zenguy.com — a faithful port of the approved design
(`Zenguy Marketing Site.html`) to Astro 7 + Tailwind CSS v4, deployed as a Cloudflare
static-assets Worker (`zenguy-website`).

## Commands

```bash
pnpm --filter @zenguy/website dev      # http://localhost:4400
pnpm --filter @zenguy/website build    # outputs dist/
pnpm --filter @zenguy/website preview  # serve the built site on :4400
pnpm --filter @zenguy/website deploy   # astro build && wrangler deploy
```

Attach `zenguy.com` (+ `www`) to the `zenguy-website` worker at launch.

## Porting notes

- Every color, size, and line of copy comes 1:1 from the design file; tokens live in
  `src/styles/global.css` (`@theme`). Do not restyle — extend.
- Fonts: Geist, Geist Mono, Caveat (Google Fonts; the original embedded them as data URIs).
- The design's logo image was exported as a dead `blob:` URL — the mark is recreated in
  `src/components/Logo.astro` (violet rounded square + wordmark). Swap in the real asset when
  you have it.
- The original was a fixed 1180px desktop mock; responsive stacking (`max-lg`/`max-md`) was
  added without touching the desktop rendering.
- Primary CTAs ("Start free", "Sign in") point to `https://app.zenguy.com`; in the mock they
  pointed to `#pricing`. Footer "Resources"/"Company" links are placeholders (`#`) until those
  pages exist. Copy says "Start free · Ten runs to try it" — confirm the free-trial offer with
  billing before launch (V1 spec had no trial).
