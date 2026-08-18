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
- [ ] If the repo-root workspace files don't exist yet, create them **exactly** as follows (identical to TASKS_BACKEND BE-001 — if they exist, verify and skip): root `package.json` `{ "name": "zenguy", "private": true, "engines": { "node": ">=22" }, "scripts": { "dev:api": "pnpm --filter @zenguy/api dev", "dev:web": "pnpm --filter @zenguy/web dev", "build": "pnpm -r build", "test": "pnpm -r test", "typecheck": "pnpm -r typecheck" } }`; `pnpm-workspace.yaml` (`packages: ["apps/*"]`); `tsconfig.base.json` (strict, ES2023, Bundler resolution, noUncheckedIndexedAccess, verbatimModuleSyntax); `.gitignore` (`node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `.env*`, `coverage/`, `*.log`, `.DS_Store`); `.editorconfig`.
- [ ] Create `apps/web/package.json`: name `@zenguy/web`, `"type": "module"`, scripts `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).
- [ ] Install: `pnpm --filter @zenguy/web add react react-dom react-router-dom @tanstack/react-query react-hook-form @hookform/resolvers zod recharts lucide-react clsx` and dev deps `pnpm --filter @zenguy/web add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest`.
- [ ] `apps/web/tsconfig.json` extends `../../tsconfig.base.json`, adds `"jsx": "react-jsx"`, `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, `"types": ["vite/client"]`, include `src`, `vite.config.ts`.
- [ ] `apps/web/index.html`: `<html lang="en">`, `<title>Zenguy</title>`, viewport meta, Google Fonts preconnect + Inter stylesheet (`https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`), `<div id="root">`, module script `/src/main.tsx`.
- [ ] `apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } } },
});
```
- [ ] `src/main.tsx` rendering `<App />` inside `<React.StrictMode>`; minimal `App.tsx` showing "Zenguy" centered; `src/styles/index.css` with `@import "tailwindcss";` imported from `main.tsx`.
- [ ] Verify `pnpm --filter @zenguy/web dev` renders and `build` outputs `dist/`. Commit.

### FE-002: Design tokens & base styles
- [ ] Replace `src/styles/index.css` with Tailwind v4 theme tokens (`@theme`) — this is the whole visual identity; use these everywhere, never ad-hoc hex values:
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
- [ ] Base layer: `body` → `bg-zinc-50 text-zinc-900 font-sans text-sm antialiased`. Global focus style: `*:focus-visible` → 2px `accent-600` ring, offset 2.
- [ ] Visual rules (write them as a comment block at the top of the file so they're always in view):
  - Cards: `bg-white border border-zinc-200 rounded-lg` — **borders, not shadows** (shadows only on overlays: `shadow-lg`).
  - Page container: `max-w-6xl mx-auto px-4 md:px-6 py-6`; page title `text-xl font-semibold`; section titles `text-sm font-semibold text-zinc-900`; secondary text `text-zinc-500`.
  - Spacing rhythm: 4/8/12/16/24; dense tables (`py-2.5`); controls height 36px (`h-9`).
  - One accent color (indigo). Status colors ONLY for status. No gradients, no dark mode in V1.
- [ ] Commit.

### FE-003: Deployment wiring note
- [ ] Add `apps/web/README.md`: how dev proxy works (needs `pnpm --filter @zenguy/api dev` on :8787), how prod works (API worker serves `apps/web/dist`; **always run `pnpm --filter @zenguy/web build` before `wrangler deploy` of the API**), env note: there are NO frontend env vars — all runtime config (Paddle token, environment) comes from `GET /api/billing/config`.
- [ ] Verify the built app is servable by the API worker: `pnpm --filter @zenguy/web build && pnpm --filter @zenguy/api dev` → open `http://localhost:8787` → the React app loads (API worker serves dist; if the api app isn't scaffolded yet, note it and move on).

### FE-004: Astro landing (Coming soon)
- [ ] Create `apps/landing/package.json` (`@zenguy/landing`, scripts `dev`: `astro dev`, `build`: `astro build`, `deploy`: `astro build && wrangler deploy`) and install `pnpm --filter @zenguy/landing add astro` + `-D wrangler`.
- [ ] `apps/landing/astro.config.mjs`: `import { defineConfig } from "astro/config"; export default defineConfig({ output: "static" });`
- [ ] `apps/landing/src/pages/index.astro` — single centered page, no client JS: dark zinc-950 background; wordmark `zenguy` (Inter 700, white, tracking-tight, accent-indigo dot: `zenguy.`); tagline `Describe what your website should do. Zenguy checks it in a real browser — on a schedule, with alerts.`; sub-line `Coming soon.`; button `Open the app →` linking `https://app.zenguy.com` (white text on `#4f46e5`, rounded-lg, px-5 py-2.5); footer `© 2026 Zenguy`. Inline `<style>` (Inter via same Google Fonts link), responsive, centered flex column, max-w-xl.
- [ ] `apps/landing/wrangler.jsonc`: `{ "name": "zenguy-landing", "compatibility_date": "2026-08-01", "assets": { "directory": "./dist" } }` (custom domain `zenguy.com` attached at deploy time — note in a comment).
- [ ] Verify `pnpm --filter @zenguy/landing build` outputs `dist/index.html`. Commit. (This is the ONLY marketing surface in V1 — nothing else gets built, §29.)

# Phase 1 — UI kit (`src/components/ui/`)

> Rules for every UI component: typed props with sensible defaults; `className` passthrough merged with `clsx`; no business logic; keyboard accessible. Build them all before any page — pages must never hand-roll buttons/inputs.

### FE-005: Button, IconButton, Spinner
- [ ] `Button.tsx`: props `variant: "primary" | "secondary" | "danger" | "ghost"` (default secondary), `size: "sm" | "md"` (default md, h-9; sm h-8), `loading?: boolean` (shows Spinner, disables), `disabled`, `type` (default "button"), `children`, all button HTML props. Styles: primary `bg-accent-600 hover:bg-accent-700 text-white`; secondary `bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800`; danger `bg-danger-600 hover:bg-danger-700 text-white`; ghost `text-zinc-600 hover:bg-zinc-100`. Rounded-md, font-medium, disabled `opacity-50 pointer-events-none`.
- [ ] `IconButton.tsx`: square h-8 w-8 ghost button wrapping a lucide icon, `aria-label` **required**.
- [ ] `Spinner.tsx`: lucide `Loader2` with `animate-spin`, sizes 4/5/6.

### FE-006: Form controls
- [ ] `Input.tsx`, `Textarea.tsx` (auto min-h-28 for instructions), `Select.tsx` (native `<select>` styled), `Checkbox.tsx`, `Toggle.tsx` (accessible switch: `role="switch"`, `aria-checked`, accent when on): all `forwardRef` (react-hook-form compatible), error state prop `invalid?: boolean` → `border-danger-600`.
- [ ] `Field.tsx`: wrapper `({ label, htmlFor, error?, hint?, required?, children })` rendering label (`text-sm font-medium`, red asterisk when required), children, hint (`text-xs text-zinc-500`), error (`text-xs text-danger-600`, `role="alert"`).
- [ ] `form.ts` helper: `fieldError(formState, name): string | undefined` to wire RHF errors into `Field`.

### FE-007: Layout primitives
- [ ] `Card.tsx` (`title?`, `actions?` right slot, `padding` default p-4), `PageHeader.tsx` (`title`, `description?`, `actions?` — used at the top of every page), `DescriptionList.tsx` (`items: { label, value: ReactNode }[]`, 2-col responsive grid), `Divider.tsx`.
- [ ] `EmptyState.tsx`: `({ icon?, title, description?, action? })` — centered, dashed border card. Used by every list page (copy Appendix D).
- [ ] `Skeleton.tsx` (pulsing zinc-200 blocks) + `TableSkeleton` (5 rows), `ErrorState.tsx` (`({ message?, onRetry })` — danger-tinted card with Retry button; default message `Something went wrong. Please try again.`).

### FE-008: Overlays
- [ ] `Modal.tsx`: portal to body; backdrop `bg-zinc-950/40`; panel centered `max-w-lg w-full bg-white rounded-lg shadow-lg`; closes on Escape and backdrop click; focus trapped inside while open (loop Tab within focusable elements); `title`, `children`, `footer?`. Body scroll locked while open.
- [ ] `ConfirmDialog.tsx` built on Modal: `({ title, body, confirmLabel = "Confirm", tone: "default" | "danger", requireText?: string, onConfirm })` — when `requireText` set, an input must equal it before the confirm button enables (used for workspace delete). Confirm button shows loading during async `onConfirm`.
- [ ] `Dropdown.tsx`: trigger + menu (portal, positioned under trigger, `role="menu"`, arrow-key navigation, Escape/blur closes); `items: { label, icon?, tone?: "danger", onSelect, disabled? }[]`. Used for row action menus (`MoreHorizontal` icon trigger).
- [ ] `Tooltip.tsx`: simple hover/focus title-style tooltip (positioned span, no library).

### FE-009: Data display & formatters
- [ ] `Table.tsx` — generic: `columns: { key, header, className?, render: (row) => ReactNode }[]`, `rows: T[]`, `rowKey(row)`, `onRowClick?`, `loading` (renders TableSkeleton), `empty` (ReactNode). Semantics: real `<table>` with `<th scope="col">`; wrapper `overflow-x-auto`; row hover `bg-zinc-50` + `cursor-pointer` when clickable.
- [ ] `LoadMore.tsx`: `({ nextCursor, loading, onMore })` — centered secondary button `Load more`, hidden when cursor null.
- [ ] `Tabs.tsx` (`items: { key, label, count? }[]`, controlled value; underline style, accent for active) and `Badge.tsx` (`tone: "ok" | "danger" | "warn" | "info" | "neutral" | "accent"`, subtle `-50` bg + `-700` text, rounded-full px-2 py-0.5 text-xs font-medium).
- [ ] `StatusBadge.tsx`: `({ status: string, passedAfterRetry?: boolean })` — maps **every** status via the table in **Appendix B** (run/attempt, monitor, incident, delivery); dot + label; when `passedAfterRetry` also renders the amber `Passed after retry` badge next to it (tooltip: retry copy from Appendix D).
- [ ] `lib/format.ts`: `formatDateTime(iso, timeZone)` (`14 Aug 2026, 09:32`), `formatTime(iso, tz)`, `formatRelative(iso)` (`3m ago`, `in 2h`, days beyond 7 → date), `formatDuration(ms | null)` (`45s`, `3m 12s`, `1h 04m`, `—` for null), `formatEuros(cents)` (`39,00 €` — es-ES style comma, non-breaking space), `formatPct(n | null)` (`99.98%` / `—`), `formatInterval(hours)` (`Every 6 hours` / `Every hour`), `formatFrequency(seconds)` (`Every 5 min`, `Every hour`, `Every 24 hours`).
- [ ] `CopyButton.tsx` (clipboard + toast `Copied`).
- [ ] Unit tests (vitest) for every formatter (edge cases: null, 0, 59s→`59s`, 60s→`1m 00s`, cents rounding).

### FE-010: Toasts
- [ ] `contexts/ToastContext.tsx` + `useToast()`: `toast.success(msg)`, `toast.error(msg)`; stacked top-right, auto-dismiss 4 s (errors 6 s), manual close, `role="status"` / `aria-live="polite"`; max 4 visible.
- [ ] Convention (use everywhere): mutation success → short toast (`Test created`); mutation failure → `toast.error(apiErrorMessage(e))` where `apiErrorMessage` extracts the envelope message with fallback `Something went wrong`.

# Phase 2 — API client & auth core

### FE-011: API client with auto-refresh
- [ ] `lib/auth-token.ts`: module holding `{ accessToken: string | null, expiresAt: number | null }` in memory with `setToken(token, expiresInSeconds)`, `getToken()`, `clearToken()`, and `onExpiringSoon(cb)` — a single `setTimeout` scheduled at `expiresIn - 60` seconds that fires `cb` (proactive refresh); rescheduled on every `setToken`.
- [ ] `lib/api.ts`:
  - `export class ApiError extends Error { code: string; status: number; details?: { field: string; message: string }[] }`.
  - Core `request(method, path, body?, opts?)`: fetch `path` (always relative `/api/...`), headers `Content-Type: application/json` + `Authorization: Bearer <token>` when present, `credentials: "same-origin"`; parse envelope: ok → `json.data` (204 → undefined); error → throw `ApiError` from `json.error`.
  - **Auto-refresh:** on 401 for any path except `/api/auth/*`: await `ensureFreshToken()` then retry the request **once**; still 401 → `clearToken()` + emit `authEvents.signedOut` + throw. `ensureFreshToken()` single-flight: one shared in-flight `POST /api/auth/refresh` promise (`{ user, accessToken, expiresIn }` → `setToken`); concurrent callers await the same promise. Also called by the proactive timer.
  - `authEvents`: tiny emitter `{ onSignedOut(cb) }` consumed by AuthContext.
  - Exports: `apiGet<T>(path)`, `apiPost<T>(path, body?)`, `apiPatch`, `apiPut`, `apiDelete`, `apiGetBlob(path)` (for the report download — returns `{ blob, filename }` parsing `Content-Disposition`).
- [ ] Vitest with mocked `fetch`: envelope unwrap; ApiError fields; 401 → refresh → retry once (assert order and single retry); concurrent 401s trigger ONE refresh call; refresh failure signs out; `/api/auth/login` 401 does NOT trigger refresh.

### FE-012: API types & auth context
- [ ] `src/api/types.ts`: transcribe **Appendix A** into TypeScript interfaces/unions verbatim (this file is the single source of truth for the whole app — every fetcher and component imports from it; never inline-type an API payload).
- [ ] `src/api/auth.ts`: `register`, `login`, `logout`, `refresh`, `me`, `verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword` — thin wrappers over `lib/api`.
- [ ] `contexts/AuthContext.tsx`: state `{ status: "loading" | "signedOut" | "signedIn", user: User | null }`. On mount: try `refresh()` → signedIn (sets token) / 401 → signedOut (silent). Exposes `signIn(email, password)`, `signOut()` (calls API logout, clears token, → `/signin`), `refreshUser()`, and subscribes to `authEvents.onSignedOut`. While `loading` render a full-screen centered Spinner (app never flashes).
- [ ] Route guards in `App.tsx` helpers: `RequireAuth` (signedOut → `<Navigate to="/signin" state={{ next }} />`; signedIn but `!user.emailVerified` → `/verify-pending` except on that page), `PublicOnly` (signedIn → `/`).

### FE-013: Router skeleton
- [ ] `App.tsx` with `BrowserRouter` + full route tree (all elements `React.lazy` page stubs rendering `PageHeader` for now):
  - Public: `/signin`, `/signup`, `/check-email`, `/verify-email`, `/forgot-password`, `/reset-password`, `/invitations/:token`.
  - Authed, no workspace chrome: `/verify-pending`, `/onboarding/workspace`, `/w/:wsId/setup/billing`.
  - Authed + AppLayout under `/w/:wsId/`: `overview`, `tests`, `tests/new`, `tests/:testId`, `tests/:testId/edit`, `runs/:runId`, `uptime`, `uptime/new`, `uptime/:monitorId`, `uptime/:monitorId/edit`, `incidents`, `incidents/:incidentId`, `notifications`, `secrets`, `members`, `billing`, `settings`.
  - `/` → resolver: signedIn → navigate to `/w/<last used wsId from localStorage, else first workspace>/overview`, or `/onboarding/workspace` when no workspaces; signedOut → `/signin`.
  - `*` → `NotFound.tsx` (404 card + link Home).
- [ ] Top-level `ErrorBoundary` (class component) rendering `ErrorState` with reload button. `QueryClient` defaults: `staleTime: 10_000`, `retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2`, `refetchOnWindowFocus: true`.

# Phase 3 — Auth screens

> Shared chrome `AuthShell` component: centered column max-w-sm, wordmark `zenguy.` on top, card with the form, small footer links. Build it in FE-014 and reuse.

### FE-014: Sign in
- [ ] `pages/auth/SignIn.tsx`: fields Email, Password (RHF + zod: email format, password required); submit → `signIn`; success → navigate to `state.next ?? "/"`. Errors: `INVALID_CREDENTIALS` → inline form error `Incorrect email or password.`; `RATE_LIMITED` → `Too many attempts. Try again in a moment.`; other → toast. Links: `Forgot password?` → `/forgot-password`; footer `Don't have an account? Sign up`.
- [ ] `pages/auth/VerifyPending.tsx`: shown when signed in but unverified — `Verify your email` heading, `We sent a verification link to <email>.`, `Resend email` button (calls resend, then 60-s countdown disable), `Sign out` link. Auto-poll `me()` every 10 s → verified → navigate `/`.

### FE-015: Sign up
- [ ] `pages/auth/SignUp.tsx`: Name, Email, Password, Confirm password (zod: min 8, confirm matches), required checkbox `I accept the Terms of Service and Privacy Policy` (plain links to `https://zenguy.com/terms` / `/privacy`). Submit → `register` → navigate `/check-email` passing the email via router state. `CONFLICT` → inline `An account with this email already exists.` + link to sign in.
- [ ] `pages/auth/CheckEmail.tsx`: `Check your inbox` — `We sent a verification link to <email>.`, Resend button with the same 60-s cooldown, link `Back to sign in`.

### FE-016: Verify email, forgot & reset password
- [ ] `pages/auth/VerifyEmail.tsx` (`?token=`): on mount POST verify → success state `Email verified` + `Sign in` button; `GONE` → `This verification link is invalid or has expired.` + resend form (email input).
- [ ] `pages/auth/ForgotPassword.tsx`: email field → always success state `If an account exists for <email>, we've sent a reset link.`
- [ ] `pages/auth/ResetPassword.tsx` (`?token=`): New password + confirm → success → `Password updated. Sign in with your new password.` + button; `GONE` → invalid-link state with link to forgot.

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

<!-- SPLIT:FE2 -->
