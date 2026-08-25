# design-sync notes

- Source: apps/frontend (Vite React app; components in apps/frontend/src/components + src/components/ui). No Storybook anywhere in the repo (confirmed with user 2026-08-25). No dedicated DS package — this app IS the design system source.
- Repo engines pins node 22.23.2 but no version manager is installed on this machine; synced fine with system node v26.5.0.
- Install: `pnpm i --frozen-lockfile` at repo root (apps/app is excluded from the workspace — standalone Expo project).
- **Entry trick**: the app has no dist/library entry. The converter is invoked with `--entry apps/frontend/dist/index.es.js` — a deliberately NONEXISTENT path. It anchors PKG_DIR at apps/frontend (walk-up) and forces synth-entry mode from src. Do not "fix" this path.
- `srcDir` is `src/components` — without it the synth entry sweeps src/main.tsx (drags in the raw Tailwind CSS entry, which esbuild can't resolve) and all pages/.
- **Types**: the app shipped no .d.ts, so every props contract collapsed to `[key: string]: unknown`. Fix: `apps/frontend/tsconfig.dts.json` + `.design-sync/make-dts.sh` emit a declaration tree to `dist/types/` with a barrel index.d.ts, and `"types": "dist/types/index.d.ts"` was added to apps/frontend/package.json (benign for the app; required by the extractor). Run make-dts.sh after any component API change (it's in buildCmd).
- **CSS**: Tailwind v4 (`@import "tailwindcss"` + `@theme` tokens in src/styles/index.css) can't be consumed raw. `.design-sync/make-css.sh` builds `apps/frontend/dist/ds-entry.css` = Google Fonts @import (Inter / IBM Plex Mono / Newsreader, same URL as index.html) + the compiled Vite CSS asset. `cssEntry` points there. Compiled CSS only contains classes the APP uses — preview glue must use inline styles, not arbitrary Tailwind classes.
- Fonts are remote (Google Fonts) — `[FONT_REMOTE]` on validate is expected, not a miss.
- Playwright for the render check: cache at ~/Library/Caches/ms-playwright has chromium-1228 → playwright@1.61.0 (installed in .ds-sync). Re-verify the pairing if the cache changes.
- AppLayout and ActivityTracker take no props — `dtsPropsFor` pins them to empty bodies (extractor can't derive from a zero-arg function).
- Grouping (core/forms/overlays/data/app) comes from regroup stubs in `.design-sync/docs/<Name>.md` + a full docsMap enumeration — there are no real per-component docs in the repo, so the enumeration IS the grouping mechanism here.
- Preview provider: `.design-sync/ds-provider.tsx` (via extraEntries) = MemoryRouter + QueryClientProvider (retry:false) + AuthProvider. API queries stay pending in previews → fetching components show loading UIs.

## Re-sync risks

- `apps/frontend/dist/` is build output: ds-entry.css, dist/types/, and the fake --entry path all assume `buildCmd` ran first. A re-sync on a fresh clone MUST run buildCmd before the converter.
- The Google Fonts URL in make-css.sh is a copy of the one in apps/frontend/index.html — if the app changes font loading, update make-css.sh.
- Compiled CSS is generated from app usage: a component whose classes stop being used elsewhere in the app could silently lose styling in cards. Watch for newly-unstyled renders after big app refactors.
- The `types` field in apps/frontend/package.json and tsconfig.dts.json are sync infrastructure — if someone removes them, every .d.ts collapses to stubs again.

## Folded wave learnings (2026-08-25)

- DSProvider now includes ToastProvider (CopyButton's useToast) and WorkspaceProvider behind a matched route `/w/:wsId/*` (MemoryRouter starts at /w/ws_demo/overview), plus a module-scope fetch mock answering exactly `POST /api/auth/refresh` and `GET /api/workspaces` with demo data (`subscriptionStatus` must be ACTIVE or WorkspaceProvider navigates to billing setup). The mock passes everything else through and ships in the bundle deliberately — app-shell components need it to mount in Claude Design too.
- Contexts must be imported RELATIVELY from app source in ds-provider.tsx so they share the bundle's module graph — importing them any other way creates second context instances components can't read.
- Components that fetch via react-query don't have to settle for skeletons: a module-scope `window.fetch` mock in the preview .tsx (answering `/api/...` with the `{"data": …}` envelope) renders the real UI (used by AttemptDetail, RunStatusPanel previews).
- ActivityTracker renders `null` by design (page-visit beacon) — permanently a floor card; not a failure.
- Dropdown has no controlled open prop — its preview clicks the trigger in a mount effect. Tooltip likewise — its open cell uses an autoFocus child (`group-focus-within`). If either gains a controlled prop, simplify the previews.
- Single-card overlays pick the FIRST export as the shown story — keep the canonical open state first in Modal/ConfirmDialog/Dropdown previews.
- `Usage.includedRuns` is the literal 300 (single-plan) — UsageMeter stories sweep 118/252/341 of 300.
- AuthShell's split marketing panel is lg:-gated; at the 900px capture viewport the stacked variant renders (graded good). A viewport override could show the two-column layout later.
- Capture can report "0 with errors" while cells crash blank — always eyeball sheets.
- DomainListInput/EmailListInput `invalid` styles only the inner input; the Field-level error text is the visible affordance. Toggle's invalid border is very subtle — component behavior, not preview bugs.

## Known render warns

- `[FONT_REMOTE]` Inter / IBM Plex Mono / Newsreader — expected (Google Fonts at runtime).
- ActivityTracker floor card (renders null by design).
- ScreenshotViewer [RENDER_THIN] 'variants render identically' is benign: both cells are full-viewport portal captures (fixed positioning collapses measured size); cardMode single shows EvidenceViewer. Verified visually 2026-08-25.
