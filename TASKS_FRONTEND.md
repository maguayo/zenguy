# Zenguy — Frontend Implementation Tasks (TASKS_FRONTEND.md)

> **For the implementing agent:** This document is your complete work order for the Zenguy web app (and the tiny Astro landing). Work through the tasks **strictly in order**. Every decision is already made — do not redesign, swap libraries, or invent features. The API contract in **Appendix A** is authoritative and matches what the backend agent builds from `TASKS_BACKEND.md`: build against it exactly. If this file and `PROJECT.md` conflict, this file wins.

**Goal:** Build the complete Zenguy V1 web application: auth, workspaces with RBAC-aware UI, Paddle billing onboarding, natural-language Browser Tests with live run progress and rich evidence viewers, Uptime monitors with charts, Incidents, Notification channels, Secrets, Members, Usage & Billing, and Workspace settings — plus a one-page Astro "Coming soon" landing.

**Stack (fixed, per PROJECT.md §0):** React 19 + Vite + TypeScript (strict) + **Tailwind CSS v4** (`@tailwindcss/vite`). Routing: `react-router-dom`. Server state: `@tanstack/react-query`. Forms: `react-hook-form` + `zod` (`@hookform/resolvers`). Charts: `recharts`. Icons: `lucide-react`. Class joining: `clsx`. Landing: **Astro** (static). No other UI/state libraries — no Redux, no component kits, no CSS-in-JS.

**How it runs:** In production the backend Worker serves `apps/web/dist` as static assets and the API under `/api/*` on the **same origin** (`app.zenguy.com`) — so the app always calls the API with relative URLs (`/api/...`), no CORS anywhere. In development Vite (port 5173) proxies `/api` to `wrangler dev` (port 8787). The refresh token lives in an HttpOnly cookie set by the API; the frontend never touches it. The access token (30-min JWT) lives **in memory only** and auto-refreshes.

**Boundaries:** Frontend owns `apps/web/**` and `apps/landing/**`. **Never modify `apps/api/**`.** Repo-root workspace files are created by the backend agent (`TASKS_BACKEND.md` BE-001) — if they don't exist yet, create them with exactly the contents replicated in FE-001 below.

---

## How to work through this file

1. Do tasks in order (`FE-001` …). Mark checkboxes `[x]` as you complete them; commit per task with message `FE-0XX: <title>`.
2. **Definition of Done (every task):** `pnpm --filter @zenguy/web typecheck` passes; `pnpm --filter @zenguy/web build` succeeds; `pnpm --filter @zenguy/web test` passes (where tests exist); every new screen handles loading / error / empty states (skeleton or spinner, error card with retry, empty state with CTA); no console errors in the browser.
3. Backend may be developed in parallel. To run against it: in one terminal `pnpm --filter @zenguy/api dev` (after its migrations/seed — see `apps/api/README.md`), in another `pnpm --filter @zenguy/web dev`. Until an endpoint exists you can still build the screen — the contract in Appendix A is frozen.
4. All UI copy is **English**. Required exact strings are in **Appendix D** — use them verbatim.
5. Permissions: the UI hides or disables what the role can't do (Appendix C), but never relies on that for security (backend enforces).
6. Dates: render in the **workspace timezone** via `Intl.DateTimeFormat` (helpers in FE-009). Durations like `3m 12s`. Money in EUR from integer cents.
7. If something is impossible exactly as written, implement the closest equivalent and add a note under "## Deviations log" at the bottom.

## Global constraints (from PROJECT.md)

- Plan copy everywhere it appears: **39 €/month**, **300 runs included**, **0,20 € per extra run**, **unlimited members**.
- Run-consumption warning before `Test it` / `Run now` (exact copy Appendix D). Retries never consume runs.
- Staging-credentials warning on secrets and test forms (exact copy Appendix D).
- Attempt timeout is 5 minutes; passed-after-retry gets an explicit badge (`Passed after retry`).
- Run history shows **100 rows** by default with "Load more" pagination; data older than 30 days is gone (say so in empty states of old pages).
- Member = read-only: sees tests/monitors/runs/incidents/channels/secret *keys*, downloads reports; cannot create/edit/run/manage anything, cannot see Usage & Billing (nav item hidden).
- Never display a secret value anywhere — after saving, values are write-only. Slack/Discord webhook URLs display masked.
- Workspace nav: Overview, Browser Tests, Uptime, Incidents, Notifications, Secrets, Members, Usage & Billing, Workspace Settings (§8) — in that order.
- Accessibility (§28.4): every input has a `<label>`, status conveyed with text + color (never color alone), visible focus rings, keyboard-reachable menus/modals (Escape closes, focus trapped in modals).
- Responsive (§28.5): fully usable at ≥ 768px (tablet); on mobile widths the nav collapses to a drawer and tables scroll horizontally. Desktop-first polish is fine.

---

## App structure (final)

```
apps/web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx                (providers: QueryClient, Auth, Toast, Router)
    ├── App.tsx                 (route tree)
    ├── styles/index.css        (Tailwind v4 @theme tokens)
    ├── lib/                    (api.ts, auth-token.ts, format.ts, permissions.ts, paddle.ts, sse.ts)
    ├── api/                    (types.ts = Appendix A as TS; one fetcher module per backend module)
    ├── contexts/               (AuthContext, WorkspaceContext, ToastContext)
    ├── components/ui/          (Button, Input, Select, Modal, Table, Badge, Tabs, …)
    ├── components/             (AppLayout, Sidebar, WorkspaceSwitcher, StatusBadge, RunStatusPanel,
    │                            KeyValueEditor, ScreenshotViewer, IncidentTimeline, UsageMeter, …)
    └── pages/                  (auth/, onboarding/, overview/, tests/, uptime/, incidents/,
                                 notifications/, secrets/, members/, billing/, settings/, NotFound.tsx)
apps/landing/                   (Astro coming-soon, FE-004)
```

Query-key convention (used everywhere): `["me"]`, `["workspaces"]`, `["ws", wsId]`, `["ws", wsId, "overview"]`, `["ws", wsId, "tests"]`, `["ws", wsId, "tests", testId]`, `["ws", wsId, "tests", testId, "runs", filters]`, `["ws", wsId, "runs", runId]`, `["ws", wsId, "attempts", attemptId]`, `["ws", wsId, "monitors"]`, `["ws", wsId, "monitors", monitorId, "stats"]`, `["ws", wsId, "incidents", filters]`, `["ws", wsId, "channels"]`, `["ws", wsId, "secrets"]`, `["ws", wsId, "members"]`, `["ws", wsId, "billing"]`, `["ws", wsId, "audit"]`. Mutations invalidate their module's keys.

---

# Phase 0 — Scaffold & landing

### FE-001: Web app scaffold
- [x] If the repo-root workspace files don't exist yet, create them **exactly** as follows (identical to TASKS_BACKEND BE-001 — if they exist, verify and skip): root `package.json` `{ "name": "zenguy", "private": true, "engines": { "node": ">=22" }, "scripts": { "dev:api": "pnpm --filter @zenguy/api dev", "dev:web": "pnpm --filter @zenguy/web dev", "build": "pnpm -r build", "test": "pnpm -r test", "typecheck": "pnpm -r typecheck" } }`; `pnpm-workspace.yaml` (`packages: ["apps/*"]`); `tsconfig.base.json` (strict, ES2023, Bundler resolution, noUncheckedIndexedAccess, verbatimModuleSyntax); `.gitignore` (`node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `.env*`, `coverage/`, `*.log`, `.DS_Store`); `.editorconfig`.
- [x] Create `apps/web/package.json`: name `@zenguy/web`, `"type": "module"`, scripts `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).
- [x] Install: `pnpm --filter @zenguy/web add react react-dom react-router-dom @tanstack/react-query react-hook-form @hookform/resolvers zod recharts lucide-react clsx` and dev deps `pnpm --filter @zenguy/web add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest`.
- [x] `apps/web/tsconfig.json` extends `../../tsconfig.base.json`, adds `"jsx": "react-jsx"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"types": ["vite/client"]`, include `src`, `vite.config.ts`.
- [x] `apps/web/index.html`: `<html lang="en">`, `<title>Zenguy</title>`, viewport meta, Google Fonts preconnect + Inter stylesheet (`https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`), `<div id="root">`, module script `/src/main.tsx`.
- [x] `apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } } },
});
```
- [x] `src/main.tsx` rendering `<App />` inside `<React.StrictMode>`; minimal `App.tsx` showing "Zenguy" centered; `src/styles/index.css` with `@import "tailwindcss";` imported from `main.tsx`.
- [x] Verify `pnpm --filter @zenguy/web dev` renders and `build` outputs `dist/`. Commit.

### FE-002: Design tokens & base styles
- [x] Replace `src/styles/index.css` with Tailwind v4 theme tokens (`@theme`) — this is the whole visual identity; use these everywhere, never ad-hoc hex values:
```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --color-accent-50: #eef2ff;  --color-accent-100: #e0e7ff; --color-accent-600: #4f46e5;
  --color-accent-700: #4338ca;
  --color-ok-50: #ecfdf5;      --color-ok-600: #059669;    --color-ok-700: #047857;
  --color-danger-50: #fef2f2;  --color-danger-600: #dc2626; --color-danger-700: #b91c1c;
  --color-warn-50: #fffbeb;    --color-warn-600: #d97706;
  --color-info-50: #eff6ff;    --color-info-600: #2563eb;
}
```
- [x] Base layer: `body` → `bg-zinc-50 text-zinc-900 font-sans text-sm antialiased`. Global focus style: `*:focus-visible` → 2px `accent-600` ring, offset 2.
- [x] Visual rules (write them as a comment block at the top of the file so they're always in view):
  - Cards: `bg-white border border-zinc-200 rounded-lg` — **borders, not shadows** (shadows only on overlays: `shadow-lg`).
  - Page container: `max-w-6xl mx-auto px-4 md:px-6 py-6`; page title `text-xl font-semibold`; section titles `text-sm font-semibold text-zinc-900`; secondary text `text-zinc-500`.
  - Spacing rhythm: 4/8/12/16/24; dense tables (`py-2.5`); controls height 36px (`h-9`).
  - One accent color (indigo). Status colors ONLY for status. No gradients, no dark mode in V1.
- [x] Commit.

### FE-003: Deployment wiring note
- [x] Add `apps/web/README.md`: how dev proxy works (needs `pnpm --filter @zenguy/api dev` on :8787), how prod works (API worker serves `apps/web/dist`; **always run `pnpm --filter @zenguy/web build` before `wrangler deploy` of the API**), env note: there are NO frontend env vars — all runtime config (Paddle token, environment) comes from `GET /api/billing/config`.
- [x] Verify the built app is servable by the API worker: `pnpm --filter @zenguy/web build && pnpm --filter @zenguy/api dev` → open `http://localhost:8787` → the React app loads (API worker serves dist; if the api app isn't scaffolded yet, note it and move on).

### FE-004: Astro landing (Coming soon)
- [x] Create `apps/landing/package.json` (`@zenguy/landing`, scripts `dev`: `astro dev`, `build`: `astro build`, `deploy`: `astro build && wrangler deploy`) and install `pnpm --filter @zenguy/landing add astro` + `-D wrangler`.
- [x] `apps/landing/astro.config.mjs`: `import { defineConfig } from "astro/config"; export default defineConfig({ output: "static" });`
- [x] `apps/landing/src/pages/index.astro` — single centered page, no client JS: dark zinc-950 background; wordmark `zenguy` (Inter 700, white, tracking-tight, accent-indigo dot: `zenguy.`); tagline `Describe what your website should do. Zenguy checks it in a real browser — on a schedule, with alerts.`; sub-line `Coming soon.`; button `Open the app →` linking `https://app.zenguy.com` (white text on `#4f46e5`, rounded-lg, px-5 py-2.5); footer `© 2026 Zenguy`. Inline `<style>` (Inter via same Google Fonts link), responsive, centered flex column, max-w-xl.
- [x] `apps/landing/wrangler.jsonc`: `{ "name": "zenguy-landing", "compatibility_date": "2026-08-01", "assets": { "directory": "./dist" } }` (custom domain `zenguy.com` attached at deploy time — note in a comment).
- [x] Verify `pnpm --filter @zenguy/landing build` outputs `dist/index.html`. Commit. (This is the ONLY marketing surface in V1 — nothing else gets built, §29.)

# Phase 1 — UI kit (`src/components/ui/`)

> Rules for every UI component: typed props with sensible defaults; `className` passthrough merged with `clsx`; no business logic; keyboard accessible. Build them all before any page — pages must never hand-roll buttons/inputs.

### FE-005: Button, IconButton, Spinner
- [x] `Button.tsx`: props `variant: "primary" | "secondary" | "danger" | "ghost"` (default secondary), `size: "sm" | "md"` (default md, h-9; sm h-8), `loading?: boolean` (shows Spinner, disables), `disabled`, `type` (default "button"), `children`, all button HTML props. Styles: primary `bg-accent-600 hover:bg-accent-700 text-white`; secondary `bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800`; danger `bg-danger-600 hover:bg-danger-700 text-white`; ghost `text-zinc-600 hover:bg-zinc-100`. Rounded-md, font-medium, disabled `opacity-50 pointer-events-none`.
- [x] `IconButton.tsx`: square h-8 w-8 ghost button wrapping a lucide icon, `aria-label` **required**.
- [x] `Spinner.tsx`: lucide `Loader2` with `animate-spin`, sizes 4/5/6.

### FE-006: Form controls
- [x] `Input.tsx`, `Textarea.tsx` (auto min-h-28 for instructions), `Select.tsx` (native `<select>` styled), `Checkbox.tsx`, `Toggle.tsx` (accessible switch: `role="switch"`, `aria-checked`, accent when on): all `forwardRef` (react-hook-form compatible), error state prop `invalid?: boolean` → `border-danger-600`.
- [x] `Field.tsx`: wrapper `({ label, htmlFor, error?, hint?, required?, children })` rendering label (`text-sm font-medium`, red asterisk when required), children, hint (`text-xs text-zinc-500`), error (`text-xs text-danger-600`, `role="alert"`).
- [x] `form.ts` helper: `fieldError(formState, name): string | undefined` to wire RHF errors into `Field`.

### FE-007: Layout primitives
- [x] `Card.tsx` (`title?`, `actions?` right slot, `padding` default p-4), `PageHeader.tsx` (`title`, `description?`, `actions?` — used at the top of every page), `DescriptionList.tsx` (`items: { label, value: ReactNode }[]`, 2-col responsive grid), `Divider.tsx`.
- [x] `EmptyState.tsx`: `({ icon?, title, description?, action? })` — centered, dashed border card. Used by every list page (copy Appendix D).
- [x] `Skeleton.tsx` (pulsing zinc-200 blocks) + `TableSkeleton` (5 rows), `ErrorState.tsx` (`({ message?, onRetry })` — danger-tinted card with Retry button; default message `Something went wrong. Please try again.`).

### FE-008: Overlays
- [x] `Modal.tsx`: portal to body; backdrop `bg-zinc-950/40`; panel centered `max-w-lg w-full bg-white rounded-lg shadow-lg`; closes on Escape and backdrop click; focus trapped inside while open (loop Tab within focusable elements); `title`, `children`, `footer?`. Body scroll locked while open.
- [x] `ConfirmDialog.tsx` built on Modal: `({ title, body, confirmLabel = "Confirm", tone: "default" | "danger", requireText?: string, onConfirm })` — when `requireText` set, an input must equal it before the confirm button enables (used for workspace delete). Confirm button shows loading during async `onConfirm`.
- [x] `Dropdown.tsx`: trigger + menu (portal, positioned under trigger, `role="menu"`, arrow-key navigation, Escape/blur closes); `items: { label, icon?, tone?: "danger", onSelect, disabled? }[]`. Used for row action menus (`MoreHorizontal` icon trigger).
- [x] `Tooltip.tsx`: simple hover/focus title-style tooltip (positioned span, no library).

### FE-009: Data display & formatters
- [x] `Table.tsx` — generic: `columns: { key, header, className?, render: (row) => ReactNode }[]`, `rows: T[]`, `rowKey(row)`, `onRowClick?`, `loading` (renders TableSkeleton), `empty` (ReactNode). Semantics: real `<table>` with `<th scope="col">`; wrapper `overflow-x-auto`; row hover `bg-zinc-50` + `cursor-pointer` when clickable.
- [x] `LoadMore.tsx`: `({ nextCursor, loading, onMore })` — centered secondary button `Load more`, hidden when cursor null.
- [x] `Tabs.tsx` (`items: { key, label, count? }[]`, controlled value; underline style, accent for active) and `Badge.tsx` (`tone: "ok" | "danger" | "warn" | "info" | "neutral" | "accent"`, subtle `-50` bg + `-700` text, rounded-full px-2 py-0.5 text-xs font-medium).
- [x] `StatusBadge.tsx`: `({ status: string, passedAfterRetry?: boolean })` — maps **every** status via the table in **Appendix B** (run/attempt, monitor, incident, delivery); dot + label; when `passedAfterRetry` also renders the amber `Passed after retry` badge next to it (tooltip: retry copy from Appendix D).
- [x] `lib/format.ts`: `formatDateTime(iso, timeZone)` (`14 Aug 2026, 09:32`), `formatTime(iso, tz)`, `formatRelative(iso)` (`3m ago`, `in 2h`, days beyond 7 → date), `formatDuration(ms | null)` (`45s`, `3m 12s`, `1h 04m`, `—` for null), `formatEuros(cents)` (`39,00 €` — es-ES style comma, non-breaking space), `formatPct(n | null)` (`99.98%` / `—`), `formatInterval(hours)` (`Every 6 hours` / `Every hour`), `formatFrequency(seconds)` (`Every 5 min`, `Every hour`, `Every 24 hours`).
- [x] `CopyButton.tsx` (clipboard + toast `Copied`).
- [x] Unit tests (vitest) for every formatter (edge cases: null, 0, 59s→`59s`, 60s→`1m 00s`, cents rounding).

### FE-010: Toasts
- [x] `contexts/ToastContext.tsx` + `useToast()`: `toast.success(msg)`, `toast.error(msg)`; stacked top-right, auto-dismiss 4 s (errors 6 s), manual close, `role="status"` / `aria-live="polite"`; max 4 visible.
- [x] Convention (use everywhere): mutation success → short toast (`Test created`); mutation failure → `toast.error(apiErrorMessage(e))` where `apiErrorMessage` extracts the envelope message with fallback `Something went wrong`.

# Phase 2 — API client & auth core

### FE-011: API client with auto-refresh
- [x] `lib/auth-token.ts`: module holding `{ accessToken: string | null, expiresAt: number | null }` in memory with `setToken(token, expiresInSeconds)`, `getToken()`, `clearToken()`, and `onExpiringSoon(cb)` — a single `setTimeout` scheduled at `expiresIn - 60` seconds that fires `cb` (proactive refresh); rescheduled on every `setToken`.
- [x] `lib/api.ts`:
  - `export class ApiError extends Error { code: string; status: number; details?: { field: string; message: string }[] }`.
  - Core `request(method, path, body?, opts?)`: fetch `path` (always relative `/api/...`), headers `Content-Type: application/json` + `Authorization: Bearer <token>` when present, `credentials: "same-origin"`; parse envelope: ok → `json.data` (204 → undefined); error → throw `ApiError` from `json.error`.
  - **Auto-refresh:** on 401 for any path except `/api/auth/*`: await `ensureFreshToken()` then retry the request **once**; still 401 → `clearToken()` + emit `authEvents.signedOut` + throw. `ensureFreshToken()` single-flight: one shared in-flight `POST /api/auth/refresh` promise (`{ user, accessToken, expiresIn }` → `setToken`); concurrent callers await the same promise. Also called by the proactive timer.
  - `authEvents`: tiny emitter `{ onSignedOut(cb) }` consumed by AuthContext.
  - Exports: `apiGet<T>(path)`, `apiPost<T>(path, body?)`, `apiPatch`, `apiPut`, `apiDelete(path, body?)` (workspace deletion sends `{ confirmName }` in the DELETE body), `apiGetBlob(path)` (for the report download — returns `{ blob, filename }` parsing `Content-Disposition`).
- [x] Vitest with mocked `fetch`: envelope unwrap; ApiError fields; 401 → refresh → retry once (assert order and single retry); concurrent 401s trigger ONE refresh call; refresh failure signs out; `/api/auth/login` 401 does NOT trigger refresh.

### FE-012: API types & auth context
- [x] `src/api/types.ts`: transcribe **Appendix A** into TypeScript interfaces/unions verbatim (this file is the single source of truth for the whole app — every fetcher and component imports from it; never inline-type an API payload).
- [x] `src/api/auth.ts`: `register`, `login`, `logout`, `refresh`, `me`, `verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword` — thin wrappers over `lib/api`.
- [x] `contexts/AuthContext.tsx`: state `{ status: "loading" | "signedOut" | "signedIn", user: User | null }`. On mount: try `refresh()` → signedIn (sets token) / 401 → signedOut (silent). Exposes `signIn(email, password)`, `signOut()` (calls API logout, clears token, → `/signin`), `refreshUser()`, and subscribes to `authEvents.onSignedOut`. While `loading` render a full-screen centered Spinner (app never flashes).
- [x] Route guards in `App.tsx` helpers: `RequireAuth` (signedOut → `<Navigate to="/signin" state={{ next }} />`; signedIn but `!user.emailVerified` → `/verify-pending` except on that page), `PublicOnly` (signedIn → `/`).

### FE-013: Router skeleton
- [x] `App.tsx` with `BrowserRouter` + full route tree (all elements `React.lazy` page stubs rendering `PageHeader` for now):
  - Public: `/signin`, `/signup`, `/check-email`, `/verify-email`, `/forgot-password`, `/reset-password`, `/invitations/:token`.
  - Authed, no workspace chrome: `/verify-pending`, `/onboarding/workspace`, `/w/:wsId/setup/billing`.
  - Authed + AppLayout under `/w/:wsId/`: `overview`, `tests`, `tests/new`, `tests/:testId`, `tests/:testId/edit`, `runs/:runId`, `uptime`, `uptime/new`, `uptime/:monitorId`, `uptime/:monitorId/edit`, `incidents`, `incidents/:incidentId`, `notifications`, `secrets`, `members`, `billing`, `settings`.
  - `/` → resolver: signedIn → navigate to `/w/<last used wsId from localStorage, else first workspace>/overview`, or `/onboarding/workspace` when no workspaces; signedOut → `/signin`.
  - `*` → `NotFound.tsx` (404 card + link Home).
- [x] Top-level `ErrorBoundary` (class component) rendering `ErrorState` with reload button. `QueryClient` defaults: `staleTime: 10_000`, `retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2`, `refetchOnWindowFocus: true`.

# Phase 3 — Auth screens

> Shared chrome `AuthShell` component: centered column max-w-sm, wordmark `zenguy.` on top, card with the form, small footer links. Build it in FE-014 and reuse.

### FE-014: Sign in
- [x] `pages/auth/SignIn.tsx`: fields Email, Password (RHF + zod: email format, password required); submit → `signIn`; success → navigate to `state.next ?? "/"`. Errors: `INVALID_CREDENTIALS` → inline form error `Incorrect email or password.`; `RATE_LIMITED` → `Too many attempts. Try again in a moment.`; other → toast. Links: `Forgot password?` → `/forgot-password`; footer `Don't have an account? Sign up`.
- [x] `pages/auth/VerifyPending.tsx`: shown when signed in but unverified — `Verify your email` heading, `We sent a verification link to <email>.`, `Resend email` button (calls resend, then 60-s countdown disable), `Sign out` link. Auto-poll `me()` every 10 s → verified → navigate `/`.

### FE-015: Sign up
- [x] `pages/auth/SignUp.tsx`: Name, Email, Password, Confirm password (zod: min 8, confirm matches), required checkbox `I accept the Terms of Service and Privacy Policy` (plain links to `https://zenguy.com/terms` / `/privacy`). Submit → `register` → navigate `/check-email` passing the email via router state. `CONFLICT` → inline `An account with this email already exists.` + link to sign in.
- [x] `pages/auth/CheckEmail.tsx`: `Check your inbox` — `We sent a verification link to <email>.`, Resend button with the same 60-s cooldown, link `Back to sign in`.

### FE-016: Verify email, forgot & reset password
- [x] `pages/auth/VerifyEmail.tsx` (`?token=`): on mount POST verify → success state `Email verified` + `Sign in` button; `GONE` → `This verification link is invalid or has expired.` + resend form (email input).
- [x] `pages/auth/ForgotPassword.tsx`: email field → always success state `If an account exists for <email>, we've sent a reset link.`
- [x] `pages/auth/ResetPassword.tsx` (`?token=`): New password + confirm → success → `Password updated. Sign in with your new password.` + button; `GONE` → invalid-link state with link to forgot.

### FE-017: Accept invitation
- [ ] `pages/auth/AcceptInvitation.tsx` (`/invitations/:token`): fetch `GET /api/invitations/:token` (public). Shows card: `<inviterName> invited you to join "<workspaceName>" as <role>.`
  - Signed out → buttons `Sign in to accept` / `Create an account` (navigate with `state.next = /invitations/<token>`).
  - Signed in with matching email → `Accept invitation` → POST accept → toast `Welcome to <workspaceName>` → navigate `/w/<workspaceId>/overview` (and invalidate `["workspaces"]`).
  - Signed in with different email → warning `This invitation was sent to <invitation email>. You're signed in as <user email>.` + Sign out button. `GONE` → `This invitation is no longer valid.`

# Phase 4 — Workspace shell & onboarding

### FE-018: Workspace context & permissions
- [ ] `lib/permissions.ts`: `type Action = ...` and `can(role, action)` — transcribe **Appendix C** exactly (same action keys as the backend). Unit-test the full matrix.
- [ ] `contexts/WorkspaceContext.tsx` (mounted inside `/w/:wsId` layout): queries `["workspaces"]`; resolves current from the `:wsId` URL param. Exposes `{ workspaces, current, role, timezone, can: (action) => can(role, action), subscriptionStatus }`. Persists `zenguy:lastWorkspace` in localStorage on change. If `wsId` isn't in the list → full-page `Workspace not found` state with links to the user's workspaces. If the list is empty → `<Navigate to="/onboarding/workspace" />`.
- [ ] Subscription gate: if `subscriptionStatus` is `NONE` or `CANCELED` and route ≠ billing/setup → `<Navigate to={/w/${wsId}/setup/billing} />` (billing setup screen doubles as the reactivation CTA, §24.14). `PAST_DUE` → allowed through, but show the banner (FE-019).

### FE-019: App layout
- [ ] `components/AppLayout.tsx`: grid `240px sidebar + main`. Sidebar (`bg-white border-r`): wordmark `zenguy.`; **WorkspaceSwitcher** (button showing workspace name + chevron → Dropdown listing workspaces (name + role badge) with checkmark on current, navigating to `/w/<id>/overview`, divider, `+ Create workspace` → `/onboarding/workspace`); nav (order fixed, lucide icons): Overview `LayoutDashboard`, Browser Tests `Globe`, Uptime `Activity`, Incidents `Siren`, Notifications `Bell`, Secrets `KeyRound`, Members `Users`, Usage & Billing `CreditCard`, Workspace Settings `Settings`. Active item: `bg-accent-50 text-accent-700 font-medium` (NavLink). **Usage & Billing hidden when `!can("billing.view")`** (Member).
  - Bottom: user block (name, email truncated) + Dropdown (`Sign out`).
- [ ] `PAST_DUE` banner across the top of main (warn tones): `Your last payment failed. Update your payment method to keep runs going.` + button `Update payment` → billing page (owner) or `Contact your workspace owner.` text (others).
- [ ] Mobile (< 768px): sidebar hidden; top bar with hamburger (`Menu`) opening the same sidebar as a slide-over drawer (Modal-style backdrop, Escape/route-change closes) + centered wordmark.
- [ ] Main renders `<Outlet />` inside the page container (FE-002 spec). Document scroll restoration: scroll to top on route change (small `useEffect` in layout).

### FE-020: Onboarding — create workspace
- [ ] `pages/onboarding/CreateWorkspace.tsx` (AuthShell chrome, no sidebar): heading `Create your workspace`. Fields: Workspace name — prefilled `` `${user.name.split(" ")[0]}'s Workspace` `` (§7.2, editable); Timezone — `<Select>` of `Intl.supportedValuesOf("timeZone")` defaulted to `Intl.DateTimeFormat().resolvedOptions().timeZone`, with a lightweight text filter input above it.
- [ ] Submit → `POST /api/workspaces` → invalidate `["workspaces"]` → navigate `/w/<id>/setup/billing`. If the user already has workspaces, show a subtle `← Back` link to the last one (this same screen is reused for "+ Create workspace").

### FE-021: Onboarding — billing setup (Paddle)
- [ ] `lib/paddle.ts`: `loadPaddle(): Promise<Paddle>` — inject `<script src="https://cdn.paddle.com/paddle/v2/paddle.js">` once (memoized promise); `initPaddle(config)` — `Paddle.Environment.set("sandbox")` when `config.environment === "sandbox"`, then `Paddle.Initialize({ token: config.clientToken, eventCallback })`; `openCheckout({ priceId, email, workspaceId, onCompleted })` → `Paddle.Checkout.open({ items: [{ priceId, quantity: 1 }], customData: { workspace_id: workspaceId }, customer: { email }, settings: { displayMode: "overlay" } })`, wiring `checkout.completed` from the eventCallback to `onCompleted`. (`workspace_id` snake_case is what the backend webhook reads — do not rename.) Declare a minimal `Paddle` global type yourself.
- [ ] `pages/onboarding/BillingSetup.tsx` (route `/w/:wsId/setup/billing`): plan Card — `Zenguy` / big `39 €` `/ month per workspace`; bullet list: `300 browser test runs included`, `0,20 € per additional run`, `Unlimited team members`, `Uptime checks — free, unlimited`, `30-day run history & evidence`; note `Retries don't consume runs.`
  - Button `Add payment method` (primary, full width): fetch `GET /api/billing/config` → `loadPaddle` + `initPaddle` + `openCheckout`. On completed → state "Activating…" (spinner) → poll `GET /api/workspaces/:wsId/billing` every 2 s (up to 120 s) until `subscription.status === "ACTIVE"` → toast `Subscription active` → navigate `/w/:wsId/overview`. Timeout → info state `Payment received — activation is taking longer than usual.` + `Check again` button.
  - If already ACTIVE/PAST_DUE on load → redirect to overview. If status CANCELED → same screen with heading `Reactivate your workspace` (identical flow).
  - Non-owner reaching this screen: replace button with `Only the workspace owner can set up billing.` + owner's name/email.

# Phase 5 — Overview

### FE-022: Overview page
- [ ] `src/api/overview.ts` (`getOverview(wsId)`) + `pages/overview/OverviewPage.tsx`, query `["ws", wsId, "overview"]` with `refetchInterval: 30_000`.
- [ ] Layout: `PageHeader` `Overview`. Then a 3-card grid (stack on mobile):
  1. **Usage this cycle** — `UsageMeter` component (build in `components/UsageMeter.tsx`, reused by Billing page): `X of 300 runs used`, progress bar (accent; turns warn ≥ 80%, danger when overage), rows: `Included runs 300`, `Used <billableRuns>`, `Remaining <remainingRuns>`, and when overage > 0: `Extra runs <overageRuns>` + `Extra cost <formatEuros(overageAmountCents)>`; footer `Projected total <formatEuros(projectedTotalCents)> · resets <formatDateTime(periodEnd)>`.
  2. **Browser tests** — big number `total` tests; rows with dot indicators: `Running now <runningRuns>`, `Open incidents <openIncidents>` (danger when > 0, links to incidents filtered), `Failures (24 h) <failed24h>`; footer link `View tests →`.
  3. **Uptime** — `UP <up>` (ok), `DOWN <down>` (danger), `UNKNOWN <unknown>` (neutral) as three inline stats; `Open incidents` row; `Avg response (24 h) <ms> ms`; footer link `View monitors →`.
- [ ] **Recent activity** Card below: list of `activity` items — icon+tone by type (Appendix B activity table), title, `formatRelative(occurredAt)`; each row links via its `link` object (`runId` → `/w/:wsId/runs/:id`, `incidentId` → incident, `monitorId` → monitor, `channelId` → notifications). Empty → EmptyState `No activity yet` / `Create your first browser test to see activity here.` + button (hidden for Member).
- [ ] Loading: 3 skeleton cards + list skeleton. Error: ErrorState with retry.

# Phase 6 — Browser Tests

### FE-023: Tests list
- [ ] `src/api/tests.ts`: `listTests`, `getTest`, `createTest`, `updateTest`, `deleteTest`, `validateDraft`, `runNow`, `listRuns`, `getRun`, `getAttempt`, `downloadReport` (uses `apiGetBlob`).
- [ ] `pages/tests/TestsListPage.tsx` (§18.5): `PageHeader` `Browser Tests` + primary `New test` (hidden unless `can("tests.manage")`). Table columns: **Name** (medium weight, device sub-line `Desktop · Every 6 hours`), **Last status** (`StatusBadge` from `lastRun` + `formatRelative(lastRun.finishedAt)`; `—` when never run), **Next run** (`formatRelative(nextRunAt)`), **Incident** (danger Badge `Open` linking to it, else `—`), **Actions** (Dropdown: `Open`, `Run now` (disabled while `lastRun` status QUEUED/RUNNING, hidden unless `can("tests.run")`), `Edit`, `Delete` (danger; both hidden unless `can("tests.manage")`)). Row click → detail.
- [ ] `Run now` flow (shared helper `useRunNow(test)` in `pages/tests/hooks.ts`): ConfirmDialog title `Run "<name>" now?`, body = run-cost copy (Appendix D) → POST run-now → toast `Run started` → navigate `/w/:wsId/runs/<runId>`; `ACTIVE_RUN_EXISTS` → toast `A run is already in progress for this test.`
- [ ] Empty: `No browser tests yet` / `Describe a flow in plain language and Zenguy will verify it in a real browser on a schedule.` + `Create your first test`. Loading/error states.

### FE-024: Test form (create/edit) with `Test it`
- [ ] `pages/tests/TestFormPage.tsx` serving `/tests/new` and `/tests/:testId/edit` (load + prefill on edit). RHF + zod schema mirroring the API: name 1–120, startUrl (`z.string().url()` + must start `http`), instructions min 1, device enum, intervalHours int 1–24, maxRetries int 0–3, notifyOnRecovery boolean, channelIds string[].
- [ ] Sections as titled Cards in §18.6 order:
  1. **Basics** — Name; Starting URL.
  2. **Instructions** — Textarea (8 rows), hint `Write what to do and what must be true, in plain language. Reference secrets like {{SHOP_PASSWORD}}.`; below it the staging-credentials warning banner (Appendix D, warn tones, `TriangleAlert` icon) and the token note (Appendix D, `text-xs text-zinc-500`).
  3. **Device** — two radio cards side by side: `Desktop — 1440 × 900` (Monitor icon) / `Mobile — 390 × 844` (Smartphone icon).
  4. **Schedule** — Select `Every 1 hour … Every 24 hours` (all 24 integers); timeout help copy (Appendix D) as hint.
  5. **Retries** — Select 0–3 with per-option description `3 retries — immediately, after 1 min, after 2 min`; hint `Retries run in a fresh browser and don't consume runs.`
  6. **Notifications** — checkbox list of workspace channels (name + type Badge); link `Manage channels` → notifications page; empty → `No channels yet — create one under Notifications.`
  7. **Recovery** — Toggle `Notify when this test recovers` (default ON).
  8. **Test it** — see below. 9. Sticky footer bar: `Cancel` + primary `Save test` / `Save changes`.
- [ ] **Test it** panel: run-cost copy line (Appendix D) + secondary button `Test it` (disabled while a validation run is in progress or form invalid): on click → `validateDraft(current form values)` → store `runId` → render `<RunStatusPanel wsId runId />` (FE-026 component) inline in the card. Saving is **never** blocked by a failed or missing test run (§10.5); leaving the page mid-run is allowed (the run continues server-side — mention in a hint).
- [ ] Submit → create: toast `Test created — first run scheduled` → detail page. Edit: toast `Changes saved` (+ if interval changed, backend already recomputed next run). 402 `BILLING_REQUIRED` → toast `Billing required — set up your subscription first.`

### FE-025: Test detail
- [ ] `pages/tests/TestDetailPage.tsx` (§18.7), query test + runs (first page). Header: name + `StatusBadge` of last run; actions `Run now` (useRunNow), `Edit`, Dropdown `Delete` (ConfirmDialog danger `Delete "<name>"? Its history stays available for 30 days.`) — all permission-gated.
- [ ] Open-incident banner when `openIncidentId` (danger Card: `This test has an open incident.` + `View incident →`).
- [ ] Summary Cards row: **Last result** (StatusBadge + relative time + duration), **Next run** (`formatRelative(nextRunAt)`), **Schedule** (`formatInterval` + device), **Retries** (`<maxRetries> retries`).
- [ ] **Configuration** Card: DescriptionList — Starting URL (truncated, CopyButton), Instructions (pre-wrap, collapsed to 6 lines with `Show more`), Device + viewport, Notification channels (names as Badges, `None`), Notify on recovery `Yes/No`.
- [ ] **Runs** Card (§12.1): status filter Tabs (`All`, `Passed`, `Failed`, `Timeout`, `System error`) driving the `status` query param; Table columns: Date (`formatDateTime`), Source (Badge: VALIDATION `Validation` neutral / MANUAL `Manual` info / SCHEDULED `Scheduled` neutral), Status (`StatusBadge` + passedAfterRetry), Duration, Attempts (`2 of 4`), Triggered by (user name or `—`), Billable (`1 run` / `—`). Row → run detail. `LoadMore` with cursor (100/page). Empty: `No runs yet` / `Run it now or wait for the schedule.`

### FE-026: Run detail & live progress
- [ ] `components/RunStatusPanel.tsx` — the live view used by run detail AND the form's Test it:
  - Props `{ wsId, runId, compact?: boolean }`. Query `["ws", wsId, "runs", runId]`. While status QUEUED/RUNNING: subscribe via `lib/sse.ts` → `subscribeRun(liveUrl, onUpdate)` wrapping `EventSource` (`update` → parsed Run replaces the query cache via `queryClient.setQueryData`; `done`/`error` → close; on `error` fall back to `refetchInterval: 2000` polling). Always stop on terminal status.
  - Renders: status line (`StatusBadge` + pulsing dot while running + elapsed timer ticking each second from `startedAt`), horizontal attempt stepper (`Attempt 1 ✓/✗/⏱/⚙ …` with `waited 60 s` sub-labels from `retryDelaySeconds`), latest step description (from the newest attempt's latest step, when present in the SSE payload), latest screenshot thumbnail when available. Terminal: result block — PASSED → ok Card `Passed` (+ `Passed after retry` badge when set); FAILED/TIMEOUT → danger Card with `failureReason` + expected/actual two-column blocks; SYSTEM_ERROR → neutral Card `System error on our side — this run is not billed and no incident was opened.` `compact` hides the stepper details (form usage).
- [ ] `pages/tests/RunDetailPage.tsx` (§12.3): breadcrumb `Browser Tests / <test name or "Draft validation"> / Run`. Top: `RunStatusPanel`. Meta DescriptionList: Run ID (CopyButton), Source, Device + viewport, Started / Finished, Total duration, Attempts count, Billable (`1 run` / `Not billed`), Triggered by, Incident (link when set), Model + runner version (from snapshot). **Instructions used** Card (snapshot verbatim, pre-wrap) + Starting URL.
- [ ] Report button in header: `Download report` (FileDown icon) — rendered only when status FAILED/TIMEOUT; calls `downloadReport(runId)` → create object URL → temp `<a download="<filename>">` click → revoke; 404 → toast `Report not available.`
- [ ] **Attempts** section: one collapsible Card per attempt (first failed one expanded by default, else the last): header `Attempt <index+1>` + StatusBadge + duration + `waited <n> s` when > 0; body = `AttemptDetail` (FE-027).
- [ ] Tests: none (manual QA) — but keep the SSE module pure enough to unit-test `subscribeRun` reconnect/fallback with a fake EventSource; write that test.

### FE-027: Attempt detail viewer
- [ ] `components/AttemptDetail.tsx`: props `{ wsId, attemptId, timezone }`; query `["ws", wsId, "attempts", attemptId]` (lazy — only when expanded).
- [ ] Layout (§12.4):
  - Result strip: summary text; when failed: `failureReason` highlighted; expected vs actual side-by-side bordered blocks (`Expected` / `Observed`); token usage + model as small meta line; `systemErrorCode` shown for SYSTEM_ERROR.
  - **Steps timeline**: vertical list — sequence number bubble, `actionType` mono Badge, description, `formatTime(timestamp)`, sanitized URL (truncated, Tooltip full), result dot (ok/danger); step screenshot as 96-px thumbnail (lazy `loading="lazy"`, `alt="Step <n> screenshot"`) → opens `ScreenshotViewer` at that index.
  - `components/ScreenshotViewer.tsx`: full-screen Modal lightbox over all attempt screenshots: large image, `<n> of <m>`, prev/next buttons + ArrowLeft/ArrowRight keys, caption (step description), close on Escape. Expired artifact URLs (img error) → placeholder `Screenshot expired`.
  - **Console errors** Card (collapsed count header, e.g. `Console errors (3)`): mono list `level · message · url`. **Network errors** Card: table Method / Host / Path / Status / Error. **Visited URLs** Card: ordered mono list. Each `_None captured_` empty text when empty.
- [ ] All text content renders as text (never `dangerouslySetInnerHTML`).

### FE-028: Drafts note & runs from incidents
- [ ] Ensure `/w/:wsId/runs/:runId` works for validation runs (null `testId`): breadcrumb shows `Draft validation`, no test links, banner `This was a validation run of an unsaved draft. It doesn't open incidents or send alerts.`
- [ ] From incident pages (FE-033) run links land here — verify the route accepts any runId in the workspace and shows NOT_FOUND state (`ErrorState` `This run is no longer available (runs are kept for 30 days).`) on 404.

# Phase 7 — Uptime

### FE-029: Uptime list
- [ ] `src/api/uptime.ts`: `listMonitors`, `getMonitor`, `createMonitor`, `updateMonitor`, `deleteMonitor`, `testRequest`, `listChecks`, `getStats`.
- [ ] `pages/uptime/UptimeListPage.tsx` (§18.9): `PageHeader` `Uptime` + `New monitor` (gated `uptime.manage`). Table: **Status** (StatusBadge UP/DOWN/UNKNOWN; small pulsing `Checking` info Badge appended when `checking`), **Name** (+ host sub-line: `new URL(url).host`), **Frequency** (`formatFrequency`), **Last check** (relative), **Response** (`<ms> ms` / `—`), **Incident** (`Open` link / `—`), **Actions** (Open / Edit / Delete gated). 30-s `refetchInterval`.
- [ ] Empty: `No uptime monitors yet` / `Ping an endpoint on a schedule and get alerted when it goes down. Uptime checks never consume runs.` + CTA.

### FE-030: Monitor form with request builder
- [ ] `pages/uptime/MonitorFormPage.tsx` (`/uptime/new`, `/uptime/:monitorId/edit`). Zod mirror of the API config (name, url, method enum, headers[], body, expectedStatus 100–599, bodyCondition enum + conditional fields, frequencySeconds enum, timeoutSeconds 1–30, maxRetries 0–3, notifyOnRecovery, channelIds). Cross-field zod rules: body forbidden for GET/HEAD; `bodyExpectedValue` required when condition set; `bodyConditionPath` required when `JSON_PATH_EQUALS`.
- [ ] Cards (§18.10):
  1. **Request** — Method Select (GET/POST/PUT/PATCH/DELETE/HEAD) inline with URL input (flex row); **Headers**: `components/KeyValueEditor.tsx` (rows of key/value Inputs + remove IconButton + `Add header`; build it generic: `{ value: {key,value}[], onChange, keyPlaceholder, valuePlaceholder }`); hint `Values support secrets: Authorization: Bearer {{API_TOKEN}}`; **Body**: Textarea shown unless GET/HEAD, mono font, hint `Raw text or JSON. Set a Content-Type header if needed.`
  2. **Expectations** — Expected status (number Input, default 200); Body condition Select: `None` / `Body contains` / `Body does not contain` / `Body equals` / `JSON path equals`; conditional Value Input; conditional JSON path Input (placeholder `$.status.healthy`, mono).
  3. **Schedule** — Frequency Select (exactly: Every 5/10/15/30 min, 1/3/6/12/24 h); Timeout number 1–30 `seconds`; Retries Select 0–3 (same descriptions as tests); hint `Uptime checks and retries never consume browser test runs.`
  4. **Notifications** + **Recovery** — same components as the test form (extract `ChannelPicker` + recovery Toggle into shared components in this task and refactor FE-024 to use them).
  5. **Test request** — secondary button `Send test request` (note: `Runs the request once from Zenguy. Nothing is saved and no runs are consumed.`): POST test-request with current form values → result panel: PASSED → ok Card `✓ <httpStatus> in <responseTimeMs> ms`; FAILED → danger Card with `failureReason`; below, per-condition checklist rows (`✓/✗ <type> — <detail>`); response excerpt in a collapsed mono block when present.
  6. Sticky footer `Cancel` / `Save monitor`.
- [ ] Edit mode for MEMBER-masked payloads never happens (route gated), but headers may come back decrypted for OWNER/ADMIN — prefill normally. Toasts as usual.

### FE-031: Monitor detail
- [ ] `pages/uptime/MonitorDetailPage.tsx` (§18.11): header name + StatusBadge (+ `Checking` chip) + host; actions Edit / Delete (gated, confirm). Open-incident banner as in tests.
- [ ] Stats row (query stats, `refetchInterval: 60_000`): Cards `Uptime 24 h` / `7 days` / `30 days` (`formatPct`, ok tone ≥ 99.9, warn ≥ 99, danger below; `—` for null) + `Avg response (24 h)` in ms.
- [ ] **Response time (24 h)** Card: `recharts` `ResponsiveContainer` + `AreaChart` of `series` — X = time (`formatTime` ticks, ~6), Y = ms (auto), area accent-600 at 15% fill 2-px line; failed points overlaid as danger dots (`Scatter` on same chart of `status === "FAILED"` entries at y = their responseTime or 0); Tooltip: time, `<ms> ms`, status word. Empty series → EmptyState `Not enough data yet.` Chart height 220, no grid clutter (dashed zinc-100 horizontal lines only).
- [ ] **Recent checks** Card: Table Time / Result (`Passed`/`Failed` Badge) / HTTP status / Response time / Reason (mono, `—`); `LoadMore` pagination (50/page).
- [ ] **Incidents** Card: this monitor's incidents (reuse incidents fetcher with `type=uptime` filtered client-side by resourceId, or fetch and filter — either is fine; link into incident detail). **Configuration** Card: DescriptionList of method+URL, expectations summary (`Status 200 · Body contains "healthy"`), frequency, timeout, retries, channels, recovery.

# Phase 8 — Incidents

### FE-032: Incidents list
- [ ] `src/api/incidents.ts` (`listIncidents(wsId, filters, cursor)`, `getIncident`).
- [ ] `pages/incidents/IncidentsPage.tsx` (§18.12): `PageHeader` `Incidents`. Filter bar: Tabs `Open` / `Resolved` / `All` (default Open), type Select `All types / Browser tests / Uptime monitors`, date range (two native `<input type="date">` From/To, optional). Filters → query params in the URL (shareable) → API params.
- [ ] Table: **Resource** (name + type Badge `Browser test` info / `Uptime monitor` accent), **Status** (`Open` danger pulsing dot / `Resolved` ok), **Opened** (`formatDateTime`), **Duration** (`formatDuration(durationMs)`, ticking for open ones — re-render via 30-s interval), **Last event** (relative). Row → detail. 30-s refetch on the Open tab.
- [ ] Empty (Open tab): ok-toned EmptyState `No open incidents` / `Everything is passing. Incidents appear here when a test or monitor fails after all retries.`

### FE-033: Incident detail
- [ ] `pages/incidents/IncidentDetailPage.tsx`: header `Incident — <resourceName>` + status Badge; meta line `Opened <dateTime> · <duration>` (+ `Resolved <dateTime>` when closed); button `View <browser test|monitor> →` + (when `openedByRunId`) `View failing run →`.
- [ ] `components/IncidentTimeline.tsx`: vertical timeline of `events` ascending — icon per type (OPENED `Siren` danger, FAILURE_RECORDED `XCircle` danger, NOTIFICATION_SENT `Send` info, NOTIFICATION_FAILED `AlertTriangle` warn, RESOLVED `CheckCircle2` ok, TEST_DELETED/MONITOR_DELETED `Trash2` neutral), message, `formatDateTime`, metadata chips when present (channel name, delivery status, run/check links from metadata ids).
- [ ] **Notifications sent** Card: deliveries table — Channel, Event (`Failure`/`Recovery`), Status (`Sent` ok / `Failed` danger + Tooltip with `errorSanitized`), Attempts, Time. Empty → `No notifications were configured when this incident opened.`

# Phase 9 — Notification channels

### FE-034: Channels list
- [ ] `src/api/channels.ts` (`listChannels`, `createChannel`, `updateChannel`, `deleteChannel`, `testChannel`, `listDeliveries`).
- [ ] `pages/notifications/ChannelsPage.tsx` (§18.13): `PageHeader` `Notifications` + `Add channel` (gated `channels.manage`). Grid of channel Cards (2-col desktop): type icon (EMAIL `Mail`, SMS `MessageSquare`, WHATSAPP `MessageCircle`, CALL `Phone`, SLACK `Hash`, DISCORD `Gamepad2`), name, target line from `configPreview` (emails joined / phone / masked webhook), status chips: `Disabled` neutral when `!enabled`; `Verified` ok when `verifiedAt`; last delivery dot (`SENT` ok / `FAILED` danger + relative time). Card menu (gated): `Send test`, `View deliveries`, `Edit`, `Disable`/`Enable`, `Delete`.
- [ ] `Send test` → ConfirmDialog `Send a test notification?` body `This sends a real notification to this channel.` → POST test → result toast `Test sent` / `Test failed: <errorSanitized>` + refresh list. `Delete` → ConfirmDialog danger `Delete "<name>"? It will be removed from every test and monitor that uses it.`
- [ ] Empty: `No notification channels yet` / `Create a channel once, then reuse it across tests and monitors.` + CTA.

### FE-035: Channel form (per-type)
- [ ] `pages/notifications/ChannelFormModal.tsx` — Modal launched from Add/Edit (no separate route). Step 1 (create only): type picker — 6 tile buttons (icon + label). Step 2: fields:
  - Common: Name (1–80).
  - EMAIL: `components/EmailListInput.tsx` — chips input (type address + Enter/comma adds, validates email, removable chips, max 10).
  - SMS / WHATSAPP / CALL: Phone number Input, placeholder `+34612345678`, hint `E.164 format, with country code.` WhatsApp extra hint: `The number must have WhatsApp and accept messages from your Twilio sender.`
  - SLACK: Webhook URL Input (validate prefix `https://hooks.slack.com/`), hint `Create an incoming webhook in your Slack workspace and paste the URL. Treat it like a password.`; DISCORD: same with `https://discord.com/api/webhooks/` and Discord copy.
  - Edit mode for SLACK/DISCORD: show masked URL as placeholder text `Currently: https://hooks.slack.com/…abcd` with empty input `Paste a new URL to replace it` — send `config` only when the user typed one (webhook values are never readable back).
- [ ] Save → create/update mutation → toast + invalidate. Zod validation per type mirrors backend (bad → inline field errors).

### FE-036: Delivery history
- [ ] `pages/notifications/DeliveriesDrawer.tsx`: right-side slide-over panel (reuse Modal mechanics, `max-w-md h-full ml-auto` panel) opened from a channel's `View deliveries`: header `Deliveries — <channel name>`; list rows: event Badge (`Failure` danger / `Recovery` ok / `Test` neutral), status (`Sent`/`Failed` + attempts count `2 attempts`), error text when failed (mono, truncated with Tooltip), incident link icon when `incidentId`, `formatDateTime(createdAt)`. `LoadMore` (25/page). Empty: `No deliveries yet.`

# Phase 10 — Secrets

### FE-037: Secrets page
- [ ] `src/api/secrets.ts` (`listSecrets`, `createSecret`, `replaceSecret`, `deleteSecret`).
- [ ] `pages/secrets/SecretsPage.tsx` (§18.14): `PageHeader` `Secrets` + `Add secret` (gated `secrets.manage`). Top warning banner (always visible, warn tones, TriangleAlert): staging-credentials copy (Appendix D).
- [ ] Table: **Key** (mono, `KeyRound` icon), **Allowed domains** (small neutral Badges, `*.example.com` rendered as-is), **Description** (`—`), **Updated** (relative), **Created by**; row menu (gated): `Replace value…`, `Edit domains…`, `Delete` (ConfirmDialog danger `Delete {{KEY}}? Tests that reference it will start failing.`). **Values are never shown anywhere — there is no view action.**
- [ ] Add modal: **Key** Input (auto-uppercase on change, zod `/^[A-Z][A-Z0-9_]{1,63}$/`, hint `Uppercase letters, digits and _ — e.g. SHOP_PASSWORD. Use it in instructions as {{SHOP_PASSWORD}}.`); **Value** `<input type="password" autoComplete="off">` (1–4096) + hint `You won't be able to view this value again — only replace it.`; **Allowed domains** — `components/DomainListInput.tsx` chips input (validates `hostname` or `*.hostname`, lowercases, min 1, hint `example.com matches only that host. *.example.com also matches its subdomains. Secrets are only ever typed on these domains.`); **Description** optional.
- [ ] Replace-value modal: text `The current value can't be viewed. Entering a new value replaces it immediately.` + password input → PUT. Edit-domains modal: DomainListInput + description. `CONFLICT` on create → inline `A secret with this key already exists.`
- [ ] Member view: table renders, banner renders, no action buttons. Empty: `No secrets yet` / `Store credentials once, encrypted, and reference them in tests as {{KEY}}.` + CTA (gated).

# Phase 11 — Members

### FE-038: Members page
- [ ] `src/api/members.ts` (`listMembers`, `changeRole`, `removeMember`, `listInvitations`, `invite`, `revokeInvitation`).
- [ ] `pages/members/MembersPage.tsx` (§18.15): `PageHeader` `Members` (description `Members are unlimited and free.`) + `Invite member` (gated `members.invite`).
- [ ] Members table: **Member** (name + email sub-line), **Role** Badge (OWNER accent, ADMIN info, MEMBER neutral), **Joined** (date), row menu: `Change role` submenu Admin/Member — only when `can("admins.manage")` (owner) and target isn't OWNER; `Remove` — shown when `can("members.remove")` AND (actor is owner ? target isn't OWNER and isn't self : target role is MEMBER); ConfirmDialog `Remove <name> from this workspace?`
- [ ] Invite modal: Email + Role Select — options: `Member` always; `Admin` only when `can("admins.manage")` (owner). Submit → toast `Invitation sent to <email>` → refresh pending list. `CONFLICT` → inline `Already a member.`
- [ ] **Pending invitations** Card (only when non-empty): rows email, role Badge, `Invited by <name>`, `Expires <relative>`, `Revoke` button (gated, confirm-less, toast).

# Phase 12 — Usage & Billing

### FE-039: Billing page
- [ ] `src/api/billing.ts` (`getBillingConfig`, `getBilling`, `getInvoiceUrl`).
- [ ] `pages/billing/BillingPage.tsx` (§18.16). Route-level guard: `can("billing.view")` false → `AccessDenied` card (`Only owners and admins can view billing.`) — the nav item is already hidden for Members (FE-019).
- [ ] **Plan** Card: `Zenguy — 39 €/month` + status Badge (`Active` ok / `Past due` warn / `Canceled` danger / `Not set up` neutral); bullets `300 runs included · 0,20 € per extra run · Unlimited members`; when CANCELED/NONE → primary `Set up subscription` → `/w/:wsId/setup/billing`; when `cancelAtPeriodEnd` → warn banner `Your subscription ends on <formatDateTime(periodEnd)>.`
- [ ] **Usage** Card: reuse `UsageMeter` (FE-022) + line `Current period: <periodStart> – <periodEnd>` (workspace tz).
- [ ] **Invoices** Card: table Date (`billedAt`), Invoice # (`invoiceNumber` / `—`), Total (`formatEuros(totalCents)`), Status (Badge), action `View PDF` → `getInvoiceUrl(txId)` → `window.open(url, "_blank")` (loading spinner on the row button). Empty `No invoices yet.`
- [ ] **Payment** Card — owner only (`can("billing.manage")`; admins instead see the info line `Only the owner can manage the subscription.`): `Update payment method` secondary button → opens `updatePaymentMethodUrl` in a new tab (disabled + Tooltip `Available after the first payment` when null); `Cancel subscription…` ghost-danger button → ConfirmDialog danger (`Cancel the subscription? Scheduled runs and checks stop when the current period ends. Your data stays readable for 30 days.`) → opens `cancelUrl` in a new tab (Paddle-hosted flow) → info toast `Finish cancelling in the Paddle page we just opened.`

# Phase 13 — Workspace settings

### FE-040: Settings & audit log
- [ ] `src/api/workspaces.ts` additions: `updateWorkspace`, `deleteWorkspace(wsId, confirmName)`, `transferOwnership`, `listAuditLogs`.
- [ ] `pages/settings/SettingsPage.tsx` (§18.17):
  - **General** Card (gated `workspace.settings`; read-only DescriptionList for Members — though Members normally won't navigate here, the route stays accessible): Name Input + Timezone Select (same filterable select as onboarding) + `Save changes` → PATCH → toast; workspace name in the sidebar updates via invalidation.
  - **Audit log** Card (rendered only when `can("audit.view")`): table Time (`formatDateTime`), Actor (name / `System`), Action (mono, e.g. `secret.created`), Resource (`<type> · <id>` truncated + CopyButton), Details (`<details>` disclosure with pretty-printed metadata JSON). `LoadMore` 25/page. Empty `No audit entries yet.`
  - **Danger zone** Card (danger-tinted border; owner only — hidden otherwise):
    - `Transfer ownership…` → Modal: Select of other members (name + email; empty state `Invite someone first — owners can only transfer to an existing member.`) → ConfirmDialog `Transfer ownership to <name>? You will become an Admin.` → POST → toast + invalidate workspaces (+role changes ripple through `can()`).
    - `Delete workspace…` → ConfirmDialog danger, `requireText` = workspace name, body: `This cancels the subscription immediately, stops all scheduled runs and checks, revokes invitations, and permanently removes data after the retention window. Type the workspace name to confirm.` → DELETE (send `{ confirmName }`) → clear `zenguy:lastWorkspace` → navigate `/` (lands on another workspace or onboarding).

# Phase 14 — Polish & release QA

### FE-041: Loading / error / empty audit
- [ ] Sweep every page against this table and fix gaps — each row must have: skeleton or spinner on load, `ErrorState` with retry on failure, `EmptyState` with the copy from its task: Overview, Tests list, Test form (edit load), Test detail (+ runs table), Run detail (+ each attempt lazy load), Uptime list, Monitor form (edit load), Monitor detail (stats, chart, checks), Incidents list/detail, Channels (+ deliveries), Secrets, Members (+ invitations), Billing, Settings (+ audit). 404s from deep links (expired 30-day data) → `ErrorState` with `This item is no longer available (data is kept for 30 days).`
- [ ] Global: mutations always disable their submit button while pending (`loading` prop); destructive dialogs always show consequences; every `useQuery` error path renders (no silent blanks). Navigating to a workspace you lost access to → the FE-018 `Workspace not found` state.

### FE-042: Permissions sweep
- [ ] Walk **Appendix C** against the UI as each role (seed users via `apps/api` seed + invite flows): Member sees NO create/edit/run/delete/test-send/invite buttons anywhere, no Usage & Billing nav, no Danger zone, no audit card, masked monitor headers, secret keys visible but action-less; Admin sees everything except: invite/promote Admin, billing management buttons, transfer, delete workspace; Owner sees all. Fix any control that isn't gated by `can()`.
- [ ] Defense-in-depth: a 403 `FORBIDDEN` from the API anywhere → toast `You don't have permission to do that.` (add to the shared mutation error helper); a 402 `BILLING_REQUIRED` → toast + navigate to `setup/billing`.

### FE-043: Responsive & accessibility pass
- [ ] ≤ 767 px: drawer nav works on every page; all Tables scroll horizontally without breaking the page; form Cards stack single-column; modals become near-full-screen (`max-h-[90dvh] overflow-y-auto`, side drawer full width); PageHeader actions wrap; ScreenshotViewer fits viewport.
- [ ] Keyboard: full journey with keyboard only — nav, switcher, dropdowns (arrows + Enter + Escape), tabs (arrows), modals (trap + Escape), lightbox (arrows), forms. Focus visible everywhere (FE-002 ring).
- [ ] a11y details: every input labeled (`Field` enforces), icons in icon-only buttons have `aria-label`, StatusBadge always pairs color with text (never a bare dot), toasts `aria-live`, images have alt text, pulsing/`animate-*` wrapped in `motion-safe:` variants, text contrast ≥ 4.5:1 (zinc-500 is the lightest allowed on white).

### FE-044: Final QA & acceptance walkthrough
- [ ] Full journey against the local backend (`apps/api` README: migrate + seed + `dev`, or `dev:remote` for real browser runs) — record each step's result as a checklist in this file section (append below):
  1. Sign up → verify (dev email in wrangler logs) → sign in. 2. Create workspace → Paddle sandbox checkout → ACTIVE. 3. Create secret `DEMO_TOKEN`. 4. Create email channel + send test. 5. Create browser test with `Test it` → watch live panel → PASSED. 6. `Run now` from list. 7. Edit instructions to force failure → run → FAILED → incident appears + email + report downloads. 8. Fix instructions → run → PASSED → incident resolved + recovery email. 9. Create uptime monitor (test request → save) → UP within its frequency; break the URL (edit to a 404 path with expected 200) → DOWN + incident; fix → recovery. 10. Invite a second account as Member → verify read-only UI; promote to Admin as owner → verify. 11. Billing page shows usage incremented ONLY by browser runs (uptime free, retries free — check the numbers). 12. Overview reflects all of it. 13. Workspace settings: rename, audit log lists the session's actions. 14. Mobile pass (drawer, tables) + keyboard pass.
- [ ] Map results to `PROJECT.md` §31 acceptance criteria (UI-visible ones) — every unmet criterion becomes a fix before closing this task.
- [ ] `pnpm --filter @zenguy/web typecheck && pnpm --filter @zenguy/web test && pnpm --filter @zenguy/web build` all green; `pnpm --filter @zenguy/landing build` green. Final commit `FE-044: release readiness`.

---

## Deviations log

> Append entries as `- FE-0XX: <what differed and why>`. Keep empty if nothing deviated.

---

# Appendix A — API contract (authoritative)

All endpoints are same-origin under `/api`. JSON envelopes: success `{ "data": T }`; lists `{ "data": T[], "nextCursor": string | null }` (pass `?cursor=` back verbatim); empty success HTTP 204. Errors: `{ "error": { "code": string, "message": string, "details"?: { "field": string, "message": string }[] } }` — codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED`/`INVALID_CREDENTIALS` 401, `BILLING_REQUIRED` 402, `EMAIL_NOT_VERIFIED`/`FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT`/`ACTIVE_RUN_EXISTS` 409, `GONE` 410, `RATE_LIMITED` 429 (+`Retry-After` header), `INTERNAL` 500. All timestamps are ISO 8601 UTC strings. Money is integer cents (EUR). Auth: `Authorization: Bearer <accessToken>` on everything except the public auth/invitation-info/webhook/signed-URL endpoints; the refresh cookie is HttpOnly and handled automatically by the browser.

```ts
// ── Core ──────────────────────────────────────────────────────────────────────
type User = { id: string; name: string; email: string; emailVerified: boolean; createdAt: string };
type Role = "OWNER" | "ADMIN" | "MEMBER";
type SubscriptionStatus = "NONE" | "ACTIVE" | "PAST_DUE" | "CANCELED";
type UserRef = { userId: string; name: string } | null;

// ── Auth ──────────────────────────────────────────────────────────────────────
// POST /api/auth/register        { name, email, password }            → 201 { user: User }   (no tokens; verify email first)
// POST /api/auth/verify-email    { token }                            → { verified: true }
// POST /api/auth/resend-verification { email }                        → { sent: true }       (always 200)
// POST /api/auth/login           { email, password }                  → { user, accessToken, expiresIn: 1800 } + sets refresh cookie
// POST /api/auth/refresh         (cookie only)                        → { user, accessToken, expiresIn } + rotates cookie; 401 when signed out
// POST /api/auth/logout                                               → 204 + clears cookie
// POST /api/auth/forgot-password { email }                            → { sent: true }       (always 200)
// POST /api/auth/reset-password  { token, password }                  → { reset: true }
// GET  /api/auth/me                                                   → { user: User }       (works while unverified)

// ── Workspaces / members / invitations ───────────────────────────────────────
type Workspace = { id: string; name: string; slug: string; timezone: string; role: Role; subscriptionStatus: SubscriptionStatus; createdAt: string };
// POST /api/workspaces           { name, timezone }                   → 201 Workspace
// GET  /api/workspaces                                                → Workspace[]
// GET  /api/workspaces/:wsId                                          → Workspace
// PATCH /api/workspaces/:wsId    { name?, timezone? }                 → Workspace
// DELETE /api/workspaces/:wsId   { confirmName }                      → 204
// POST /api/workspaces/:wsId/transfer-ownership { newOwnerUserId }    → { ok: true }

type Member = { userId: string; name: string; email: string; role: Role; joinedAt: string };
// GET    /api/workspaces/:wsId/members                                → Member[]
// PATCH  /api/workspaces/:wsId/members/:userId { role: "ADMIN" | "MEMBER" } → Member
// DELETE /api/workspaces/:wsId/members/:userId                        → 204

type Invitation = { id: string; email: string; role: "ADMIN" | "MEMBER"; invitedBy: UserRef; expiresAt: string; createdAt: string };
// POST   /api/workspaces/:wsId/invitations { email, role }            → 201 Invitation
// GET    /api/workspaces/:wsId/invitations                            → Invitation[]        (pending only)
// DELETE /api/workspaces/:wsId/invitations/:invitationId              → 204
// GET    /api/invitations/:token   (public)                           → { workspaceName, inviterName, email, role, expiresAt } | 410
// POST   /api/invitations/:token/accept                               → { workspaceId }

// ── Billing ───────────────────────────────────────────────────────────────────
// GET /api/billing/config                                             → { environment: "sandbox" | "production", clientToken: string, priceId: string }
type Usage = { periodStart: string; periodEnd: string; billableRuns: number; includedRuns: 300; remainingRuns: number; overageRuns: number; overageAmountCents: number; projectedTotalCents: number };
type Billing = {
  plan: { pricePerMonthCents: 3900; currency: "EUR"; includedRuns: 300; overagePerRunCents: 20 };
  subscription: { status: SubscriptionStatus; periodStart: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean;
                  updatePaymentMethodUrl: string | null; cancelUrl: string | null };  // urls only for OWNER
  usage: Usage;
  invoices: { id: string; billedAt: string | null; status: string; totalCents: number; currency: string; invoiceNumber: string | null }[];
};
// GET /api/workspaces/:wsId/billing                                   → Billing   (OWNER/ADMIN; Member 403)
// GET /api/workspaces/:wsId/billing/invoices/:transactionId/url       → { url: string }

// ── Secrets ───────────────────────────────────────────────────────────────────
type Secret = { id: string; key: string; allowedDomains: string[]; description: string | null; createdBy: UserRef; createdAt: string; updatedAt: string };
// GET    /api/workspaces/:wsId/secrets                                → Secret[]  (values NEVER returned, ever)
// POST   /api/workspaces/:wsId/secrets { key, value, allowedDomains, description? } → 201 Secret
// PUT    /api/workspaces/:wsId/secrets/:secretId { value?, allowedDomains?, description? } → Secret
// DELETE /api/workspaces/:wsId/secrets/:secretId                      → 204

// ── Notification channels ────────────────────────────────────────────────────
type ChannelType = "EMAIL" | "SMS" | "WHATSAPP" | "CALL" | "SLACK" | "DISCORD";
type ChannelConfigInput =
  | { emails: string[] }                    // EMAIL (1–10)
  | { phoneNumber: string }                 // SMS / WHATSAPP / CALL, E.164
  | { webhookUrl: string };                 // SLACK / DISCORD
type ChannelPreview = { emails?: string[]; phoneNumber?: string; webhookUrlMasked?: string };
type Channel = { id: string; name: string; type: ChannelType; enabled: boolean; configPreview: ChannelPreview; verifiedAt: string | null; lastDeliveryStatus: "SENT" | "FAILED" | null; createdAt: string };
// GET    /api/workspaces/:wsId/channels                               → Channel[]
// POST   /api/workspaces/:wsId/channels { name, type, config: ChannelConfigInput } → 201 Channel
// PATCH  /api/workspaces/:wsId/channels/:channelId { name?, enabled?, config? } → Channel
// DELETE /api/workspaces/:wsId/channels/:channelId                    → 204
// POST   /api/workspaces/:wsId/channels/:channelId/test               → { delivery: Delivery }
type Delivery = { id: string; eventType: "FAILURE" | "RECOVERY" | "TEST"; status: "PENDING" | "SENT" | "FAILED"; providerMessageId: string | null; attemptCount: number; errorSanitized: string | null; sentAt: string | null; createdAt: string; incidentId: string | null };
// GET    /api/workspaces/:wsId/channels/:channelId/deliveries?cursor&limit → Delivery[] (paginated)

// ── Browser tests ────────────────────────────────────────────────────────────
type Device = "DESKTOP" | "MOBILE";
type RunSource = "VALIDATION" | "MANUAL" | "SCHEDULED";
type RunStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "TIMEOUT" | "SYSTEM_ERROR";
type AttemptStatus = RunStatus | "STARTING";
type RunSummary = { id: string; status: RunStatus; source: RunSource; startedAt: string | null; finishedAt: string | null; durationMs: number | null; passedAfterRetry: boolean; createdAt: string } | null;
type BrowserTest = { id: string; name: string; startUrl: string; instructions: string; device: Device; intervalHours: number; maxRetries: number; notifyOnRecovery: boolean; channelIds: string[]; nextRunAt: string; createdBy: UserRef; createdAt: string; updatedAt: string; lastRun: RunSummary; openIncidentId: string | null };
type BrowserTestInput = { name: string; startUrl: string; instructions: string; device: Device; intervalHours: number; maxRetries: number; notifyOnRecovery: boolean; channelIds: string[] };
// GET    /api/workspaces/:wsId/browser-tests                          → BrowserTest[]
// POST   /api/workspaces/:wsId/browser-tests  BrowserTestInput        → 201 BrowserTest
// GET    /api/workspaces/:wsId/browser-tests/:testId                  → BrowserTest
// PATCH  /api/workspaces/:wsId/browser-tests/:testId  Partial<BrowserTestInput> → BrowserTest
// DELETE /api/workspaces/:wsId/browser-tests/:testId                  → 204
// POST   /api/workspaces/:wsId/browser-tests/validate  BrowserTestInput → 202 { runId }   (draft "Test it"; consumes 1 run)
// POST   /api/workspaces/:wsId/browser-tests/:testId/run-now          → 202 { runId } | 409 ACTIVE_RUN_EXISTS

type RunListItem = { id: string; createdAt: string; source: RunSource; status: RunStatus; durationMs: number | null; device: Device; attemptCount: number; passedAfterRetry: boolean; billable: boolean; triggeredBy: UserRef };
// GET /api/workspaces/:wsId/browser-tests/:testId/runs?cursor&limit(≤100)&status → RunListItem[] (paginated, newest first)

type RunSnapshot = { name: string; startUrl: string; instructions: string; device: Device; intervalHours: number; maxRetries: number; notifyOnRecovery: boolean; channelIds: string[]; viewport: { width: number; height: number }; modelName: string; runnerVersion: string };
type AttemptSummary = { id: string; attemptIndex: number; status: AttemptStatus; retryDelaySeconds: number; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; summary: string | null; failureReason: string | null;
  latestStep: { description: string; actionType: string; timestamp: string } | null;      // populated while running / on SSE; may be null
  latestScreenshot: { id: string; url: string } | null };
type Run = { id: string; testId: string | null; source: RunSource; status: RunStatus; snapshot: RunSnapshot; scheduledFor: string | null; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; attemptCount: number; passedAfterRetry: boolean; billable: boolean; incidentId: string | null; triggeredBy: UserRef; attempts: AttemptSummary[];
  live: { url: string } | null };   // SSE URL (self-authenticating), non-null while QUEUED/RUNNING
// GET /api/workspaces/:wsId/runs/:runId                               → Run
// GET /api/workspaces/:wsId/runs/:runId/events?exp&sig  (SSE; use live.url verbatim) — events: "update" (data = Run JSON), "done"
// GET /api/workspaces/:wsId/runs/:runId/report                        → text/markdown attachment; 404 unless final status FAILED/TIMEOUT

type ArtifactRef = { id: string; url: string; expiresAt: string };    // url is signed, valid ~10 min; re-fetch the attempt for fresh ones
type Step = { sequence: number; timestamp: string; actionType: string; description: string; urlSanitized: string | null; result: "OK" | "ERROR"; screenshot: ArtifactRef | null };
type Attempt = AttemptSummary & { expectedResult: string | null; actualResult: string | null; tokenUsage: number | null; modelName: string | null; runnerVersion: string | null; systemErrorCode: string | null; visitedUrls: string[];
  consoleErrors: { level: string; message: string; url: string | null; timestamp: string }[];
  networkErrors: { method: string; host: string; path: string; statusCode: number | null; errorType: string | null; durationMs: number | null }[];
  steps: Step[]; screenshots: ArtifactRef[] };
// GET /api/workspaces/:wsId/attempts/:attemptId                       → Attempt

// ── Uptime ────────────────────────────────────────────────────────────────────
type MonitorMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
type BodyCondition = "CONTAINS" | "NOT_CONTAINS" | "EQUALS" | "JSON_PATH_EQUALS";
type MonitorInput = { name: string; url: string; method: MonitorMethod; headers?: { key: string; value: string }[]; body?: string; expectedStatus: number; bodyCondition?: BodyCondition | null; bodyExpectedValue?: string | null; bodyConditionPath?: string | null; frequencySeconds: 300 | 600 | 900 | 1800 | 3600 | 10800 | 21600 | 43200 | 86400; timeoutSeconds: number; maxRetries: number; notifyOnRecovery: boolean; channelIds: string[] };
type Monitor = MonitorInput & { id: string; headersMasked: boolean;   // true → headers/body are null for your role (Member)
  status: "UNKNOWN" | "UP" | "DOWN"; checking: boolean; nextCheckAt: string; lastCheckAt: string | null; lastResponseTimeMs: number | null; openIncidentId: string | null; createdBy: UserRef; createdAt: string; updatedAt: string };
// GET    /api/workspaces/:wsId/uptime-monitors                        → Monitor[]
// POST   /api/workspaces/:wsId/uptime-monitors  MonitorInput          → 201 Monitor
// GET    /api/workspaces/:wsId/uptime-monitors/:monitorId             → Monitor
// PATCH  /api/workspaces/:wsId/uptime-monitors/:monitorId Partial<MonitorInput> → Monitor
// DELETE /api/workspaces/:wsId/uptime-monitors/:monitorId             → 204
// POST   /api/workspaces/:wsId/uptime-monitors/test-request  MonitorInput (name optional) → TestRequestResult  (nothing stored, no runs)
type TestRequestResult = { passed: boolean; httpStatus: number | null; responseTimeMs: number; failureReason: string | null; conditions: { type: string; passed: boolean; detail: string }[]; responseExcerpt: string | null };

type Check = { id: string; cycleId: string; attemptIndex: number; status: "PASSED" | "FAILED"; httpStatus: number | null; responseTimeMs: number | null; failureReason: string | null; checkedAt: string };
// GET /api/workspaces/:wsId/uptime-monitors/:monitorId/checks?cursor&limit → Check[] (paginated)
// GET /api/workspaces/:wsId/uptime-monitors/:monitorId/stats          → { uptime24h: number | null; uptime7d: number | null; uptime30d: number | null; avgResponseTimeMs24h: number | null; series: { t: string; responseTimeMs: number | null; status: "PASSED" | "FAILED" }[] }

// ── Incidents ────────────────────────────────────────────────────────────────
type Incident = { id: string; resourceType: "BROWSER_TEST" | "UPTIME_MONITOR"; resourceId: string; resourceName: string; status: "OPEN" | "RESOLVED"; openedAt: string; resolvedAt: string | null; durationMs: number; lastEventAt: string };
// GET /api/workspaces/:wsId/incidents?status=open|resolved&type=browser|uptime&from&to&cursor&limit → Incident[] (paginated)
type IncidentEvent = { id: string; type: "OPENED" | "FAILURE_RECORDED" | "NOTIFICATION_SENT" | "NOTIFICATION_FAILED" | "RESOLVED" | "TEST_DELETED" | "MONITOR_DELETED"; message: string; metadata: Record<string, unknown> | null; createdAt: string };
type IncidentDelivery = { id: string; channelName: string; channelType: ChannelType; eventType: "FAILURE" | "RECOVERY"; status: "PENDING" | "SENT" | "FAILED"; attemptCount: number; errorSanitized: string | null; sentAt: string | null; createdAt: string };
// GET /api/workspaces/:wsId/incidents/:incidentId                     → Incident & { events: IncidentEvent[]; deliveries: IncidentDelivery[]; openedByRunId: string | null; openedByCheckId: string | null }

// ── Overview / audit / misc ──────────────────────────────────────────────────
type ActivityItem = { id: string; type: "TEST_PASSED" | "TEST_FAILED" | "TEST_TIMEOUT" | "TEST_SYSTEM_ERROR" | "TEST_RECOVERED" | "MONITOR_DOWN" | "MONITOR_RECOVERED" | "CHANNEL_DELIVERY_FAILED"; occurredAt: string; title: string; resourceType: string; resourceId: string; resourceName: string; link: { runId?: string; incidentId?: string; monitorId?: string; channelId?: string } };
// GET /api/workspaces/:wsId/overview → { usage: Usage; browserTests: { total: number; runningRuns: number; openIncidents: number; failed24h: number }; uptime: { up: number; down: number; unknown: number; openIncidents: number; avgResponseTimeMs24h: number | null }; activity: ActivityItem[] }

type AuditEntry = { id: string; action: string; actor: UserRef; resourceType: string | null; resourceId: string | null; metadata: Record<string, unknown> | null; ip: string | null; createdAt: string };
// GET /api/workspaces/:wsId/audit-logs?cursor&limit                   → AuditEntry[] (paginated; OWNER/ADMIN)
// GET /api/health                                                     → { ok: true }
```

# Appendix B — Status → UI mapping

| Status | Badge tone | Label | Notes |
|---|---|---|---|
| `QUEUED` | neutral | Queued | |
| `STARTING` / `RUNNING` / `CHECKING` (monitor `checking`) | info | Starting / Running / Checking | pulsing dot (`motion-safe:animate-pulse`) |
| `PASSED` / `UP` / `RESOLVED` / `SENT` | ok | Passed / Up / Resolved / Sent | |
| `FAILED` / `DOWN` / `OPEN` (incident) | danger | Failed / Down / Open | |
| `TIMEOUT` | warn | Timeout | never call it "Failed" |
| `SYSTEM_ERROR` | neutral (wrench `Wrench` icon) | System error | must NOT look like a site failure; tooltip: `An error on Zenguy's side — not billed, no incident.` |
| `UNKNOWN` | neutral | Unknown | |
| `PENDING` (delivery) | neutral | Pending | |
| passed_after_retry | warn outline, next to Passed | Passed after retry | tooltip = retry copy (Appendix D) |

Run sources: `VALIDATION` → `Validation` (neutral), `MANUAL` → `Manual` (info), `SCHEDULED` → `Scheduled` (neutral). Activity icons: TEST_PASSED `CheckCircle2` ok · TEST_FAILED `XCircle` danger · TEST_TIMEOUT `Clock` warn · TEST_SYSTEM_ERROR `Wrench` neutral · TEST_RECOVERED / MONITOR_RECOVERED `HeartPulse` ok · MONITOR_DOWN `Siren` danger · CHANNEL_DELIVERY_FAILED `BellOff` warn.

# Appendix C — Permission matrix (mirror of the backend; drives `can()`)

| Action key | OWNER | ADMIN | MEMBER | UI effect when false |
|---|---|---|---|---|
| tests.view / reports.download | ✓ | ✓ | ✓ | — |
| tests.manage | ✓ | ✓ | – | hide New/Edit/Delete test |
| tests.run | ✓ | ✓ | – | hide Test it / Run now |
| uptime.manage | ✓ | ✓ | – | hide monitor mutations; headers shown masked |
| channels.manage | ✓ | ✓ | – | hide Add/Edit/Delete/Send test |
| secrets.manage | ✓ | ✓ | – | secrets table read-only (keys only) |
| members.invite | ✓ | ✓ (MEMBER role only) | – | hide Invite; Admin's role select shows only Member |
| admins.manage | ✓ | – | – | hide Change role; hide Admin option in invite |
| members.remove | ✓ | ✓ (Members only) | – | hide Remove per-row by rule |
| billing.view | ✓ | ✓ | – | hide Usage & Billing nav item |
| billing.manage | ✓ | – | – | hide payment/cancel buttons (Admin sees read-only note) |
| workspace.settings | ✓ | ✓ | – | settings form read-only |
| workspace.transfer / workspace.delete | ✓ | – | – | hide Danger zone |
| audit.view | ✓ | ✓ | – | hide Audit log card |

# Appendix D — Required copy (verbatim)

- **Run cost (before `Test it` and `Run now`):** `This will use 1 run. Retries don't use additional runs.`
- **Staging credentials warning (secrets page + test form):** `Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.`
- **Timeout help (test form, schedule section):** `Each attempt can run for up to 5 minutes. If it takes longer, it ends with a Timeout status and may be retried according to your settings.`
- **Token note (test form, instructions section):** `Tests are designed for a nominal maximum of 200,000 tokens. If a test is very large, split it into smaller tests.`
- **Passed-after-retry tooltip:** `The first attempt failed, but a fresh clean browser completed the test successfully.`
- **Report note (run detail, next to the download button):** `The report describes what was observed. It contains no credentials and doesn't assert an unverified root cause.`
- **Channel test dialog:** `This sends a real notification to this channel.`
- **Past-due banner:** `Your last payment failed. Update your payment method to keep runs going.`
- **Draft validation banner (run detail of a draft run):** `This was a validation run of an unsaved draft. It doesn't open incidents or send alerts.`
- **System error tooltip:** `An error on Zenguy's side — not billed, no incident.`
- **Expired data:** `This item is no longer available (data is kept for 30 days).`

# Appendix E — Route map

| Path | Page | Guard |
|---|---|---|
| `/signin`, `/signup`, `/check-email`, `/verify-email`, `/forgot-password`, `/reset-password` | auth pages | PublicOnly (except verify-email: public) |
| `/invitations/:token` | AcceptInvitation | public (adapts to auth state) |
| `/verify-pending` | VerifyPending | signed-in, unverified |
| `/onboarding/workspace` | CreateWorkspace | RequireAuth |
| `/w/:wsId/setup/billing` | BillingSetup | RequireAuth + member |
| `/w/:wsId/overview` | Overview | member (+ subscription redirect FE-018) |
| `/w/:wsId/tests`, `/tests/new`, `/tests/:testId`, `/tests/:testId/edit` | tests pages | member; mutations gated by `can` |
| `/w/:wsId/runs/:runId` | RunDetail | member |
| `/w/:wsId/uptime`, `/uptime/new`, `/uptime/:monitorId`, `/uptime/:monitorId/edit` | uptime pages | member |
| `/w/:wsId/incidents`, `/incidents/:incidentId` | incidents | member |
| `/w/:wsId/notifications` | channels | member |
| `/w/:wsId/secrets` | secrets | member |
| `/w/:wsId/members` | members | member |
| `/w/:wsId/billing` | billing | `billing.view` (else AccessDenied) |
| `/w/:wsId/settings` | settings | member (cards gated inside) |
| `/` | resolver → last/first workspace or onboarding | — |
| `*` | NotFound | — |
