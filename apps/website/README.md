# @zenguy/website

Public marketing site for zenguy.com — a faithful port of the approved design
(`Zenguy Marketing Site.html`) to Astro 7 + Tailwind CSS v4, deployed through
the Git-connected Cloudflare Pages project `zenguy`.

## Commands

```bash
pnpm --filter @zenguy/website dev      # http://localhost:4400
pnpm --filter @zenguy/website build    # outputs dist/
pnpm --filter @zenguy/website preview  # serve the built site on :4400
```

## Localized pricing

The static HTML keeps EUR as its no-JavaScript and local-development fallback.
On Cloudflare Pages, `/api/pricing` reads `request.cf.isEUCountry` and returns
EUR pricing for EU visitors and USD pricing for visitors with non-EU country
metadata. If that flag is unavailable, the endpoint falls back to the ISO
country code; requests with no geolocation metadata keep EUR. A CSP-compatible
external script updates every marked monthly and overage amount.
`public/_routes.json` limits Pages Functions invocations to the pricing
endpoint.

Astro's development server does not execute Pages Functions. To exercise the
edge endpoint locally, build the site and run `pnpm exec wrangler pages dev dist`
from `apps/website`.

## Deploys

Git-connected **Cloudflare Pages** project `zenguy` — every push to `main`
builds and deploys the public website independently from the frontend and API.
Required project settings (dashboard → zenguy → Settings → Build):

- **Root directory:** `apps/website`
- **Build command:** `pnpm build`
- **Build output directory:** comes from `wrangler.jsonc` (`pages_build_output_dir: ./dist`)

`zenguy.com` and `www.zenguy.com` are attached to this Pages project as active
custom domains with SSL enabled.

## Porting notes

- 2026-08-22: the hero copy/type and the dark "merge vs production" band (`Production.astro`,
  placed right after the hero) come from the revision `Zenguy Home standalone-src.html`. Its two new
  colours are the `--color-stone` / `--color-violet-soft` tokens; the hero keeps the original cards.
- 2026-08-23: the "iOS app" section (`IosApp.astro`, after Alerts) is not from a mock. The phone is
  drawn in HTML at the app's logical size (402 × 874 pt, values from `apps/app/src/theme`) and scaled
  with a transform; the Overview it shows mirrors the real screen (reference captures in the
  "Zenguy Paper & Pulse" artifact). `appStoreUrl` at the top of the component is `null` until the app
  is public on the App Store — set it and the "Download on the App Store" button replaces the
  "App Store soon" fact. New: `--color-amber` token, `bell`/`activity`/`scanface` icons, nav and
  footer "iOS app" links, "Push" in the Alerts channel list, `border-t` on Uptime.
- Every color, size, and line of copy comes 1:1 from the design file; tokens live in
  `src/styles/global.css` (`@theme`). Do not restyle — extend.
- Fonts: Geist, Geist Mono, Caveat (Google Fonts; the original embedded them as data URIs).
- The design's logo image was exported as a dead `blob:` URL — the mark is recreated in
  `src/components/Logo.astro` (violet rounded square + wordmark). Swap in the real asset when
  you have it.
- The original was a fixed 1180px desktop mock; responsive stacking (`max-lg`/`max-md`) was
  added without touching the desktop rendering.
- Primary CTAs ("Get started", "Sign in") point to `https://app.zenguy.com`; in the mock they
  pointed to `#pricing`. Footer "Documentation"/"Changelog"/"Status" and Company links are still
  placeholders (`#`). **Articles** (`/articles`, `/articles/{slug}`) are live: Markdown in
  `src/content/articles`, listing + RSS + sitemap. Workspace activation uses the paid Stripe
  Checkout; there is no public free trial.
