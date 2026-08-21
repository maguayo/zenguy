# Zenguy Mobile (Expo, iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/app`, an Expo (SDK 57) iOS app with functional parity with `apps/frontend`, authenticating securely against `apps/api`.

**Architecture:** Standalone pnpm project under `apps/app` (excluded from the workspace, hoisted `node_modules`). `expo-router` file routes mirror the web URLs; `@tanstack/react-query` + ported API modules talk to the Hono API with a bearer access token in memory and a refresh token in the Keychain via a new opt-in "native client" mode on `/api/auth/*`. UI is `StyleSheet` + theme tokens with a small primitive kit.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6, expo-router, expo-secure-store, expo-local-authentication, expo-image, expo-file-system, expo-sharing, expo-document-picker, expo-clipboard, @expo/vector-icons, @tanstack/react-query 5, react-hook-form 7, zod 4, jest-expo, @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-21-mobile-app-design.md`

## Global Constraints

- iOS only (`"platforms": ["ios"]`), bundle id `com.zenguy.app`, scheme `zenguy`.
- Access token only in memory; refresh token only in `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; nothing else from the workspace persisted.
- Non-dev builds must use an `https:` API origin (`EXPO_PUBLIC_API_ORIGIN`); dev default `http://127.0.0.1:8787`.
- Every `/api/auth/*` request from the app sends `X-Zenguy-Client: native`.
- Query keys identical to the web: `["workspaces"]`, `["billing-config"]`, `["ws", wsId, "overview"|"tests"|"channels"|"monitors"|"incidents"|"secrets"|"members"|"invitations"|"billing"|"audit", ...]`.
- Permission gating through `can(role, action)` (ported verbatim from `apps/frontend/src/lib/permissions.ts`).
- Copy (labels, toasts, empty states, confirmations) identical to the web pages unless the medium requires otherwise.
- Do not install npm packages with `npm`; use `pnpm` inside `apps/app` (`pnpm install --ignore-workspace`) and `pnpm exec expo install <pkg>` for Expo-managed versions.
- Never modify files outside `apps/app`, `apps/api/src/http/routes/auth.ts`, `apps/api/src/http/routes/auth_routes.itest.ts`, `pnpm-workspace.yaml`, root `package.json`, root `README.md`, `docs/superpowers/**` (a peer session owns the rest).
- Commit only your own paths with explicit `git add <paths>`; branch `main`.

---

## File structure

```
apps/app/
  app.config.ts                 Expo config (name, slug, scheme, ios.bundleIdentifier, infoPlist, plugins)
  eas.json                      development / preview / production profiles with EXPO_PUBLIC_API_ORIGIN
  babel.config.js               babel-preset-expo (+ remove-console in production)
  metro.config.js               expo/metro-config default
  jest.config.js                jest-expo preset, setup file
  tsconfig.json                 extends expo/tsconfig.base, strict, paths "@/*" -> "./src/*"
  package.json                  scripts: start, ios, typecheck, test, lint, prebuild
  .npmrc                        node-linker=hoisted, ignore-workspace=true
  .gitignore                    ios/, android/, .expo/, dist/, node_modules/
  assets/icon.png, assets/splash-icon.png
  app/_layout.tsx               Providers + AuthProvider + AppLock + PrivacyShield + Stack
  app/index.tsx                 RootResolver
  app/(auth)/_layout.tsx        PublicOnly stack
  app/(auth)/{sign-in,sign-up,check-email,forgot-password,reset-password}.tsx
  app/verify-email.tsx  app/verify-pending.tsx  app/invitations/[token].tsx  app/grants/[token].tsx
  app/complimentary.tsx app/privacy.tsx app/terms.tsx app/onboarding/workspace.tsx
  app/w/[wsId]/_layout.tsx      RequireAuth + WorkspaceProvider
  app/w/[wsId]/setup/billing.tsx
  app/w/[wsId]/(tabs)/_layout.tsx             Tabs
  app/w/[wsId]/(tabs)/overview.tsx
  app/w/[wsId]/(tabs)/(tests)/_layout.tsx     Stack (initialRouteName tests/index)
  app/w/[wsId]/(tabs)/(tests)/tests/{index,new}.tsx  .../tests/[testId]/{index,edit}.tsx  .../runs/[runId].tsx
  app/w/[wsId]/(tabs)/(uptime)/_layout.tsx    .../uptime/{index,new}.tsx .../uptime/[monitorId]/{index,edit}.tsx
  app/w/[wsId]/(tabs)/(incidents)/_layout.tsx .../incidents/{index}.tsx .../incidents/[incidentId].tsx
  app/w/[wsId]/(tabs)/(more)/_layout.tsx      .../more/index.tsx .../notifications/index.tsx
                                              .../notifications/[channelId]/deliveries.tsx .../secrets/index.tsx
                                              .../members/index.tsx .../billing/index.tsx .../settings/index.tsx
                                              .../account/index.tsx
  src/lib/{config,secure-storage,auth-token,api,errors,format,permissions,links,share}.ts (+ .test.ts)
  src/api/{types,auth,workspaces,overview,tests,uptime,incidents,channels,secrets,members,billing,invitations,grants}.ts
  src/contexts/{AuthContext,WorkspaceContext,ToastContext,AppLockContext}.tsx
  src/hooks/{useMutationError,useRunNow,useResendVerification}.ts
  src/theme/{colors,spacing,typography,index}.ts
  src/ui/{Screen,Card,Button,Input,PasswordInput,Field,Badge,ListRow,EmptyState,ErrorState,Spinner,Skeleton,
          SegmentedTabs,SelectSheet,Toggle,DescriptionList,Text,Divider,ActionMenu,confirm,LoadMore,index}.tsx
  src/components/{StatusBadge,RunSourceBadge,UsageMeter,RunStatusPanel,AttemptDetail,ScreenshotViewer,
                  IncidentTimeline,ChannelPicker,CopyButton,DomainListInput,EmailListInput,KeyValueEditor,
                  TimezonePicker,RoleBadge,PrivacyShield,AppLockGate,AuthShell}.tsx
  README.md
```

---

### Task 1: Native-client auth mode in the API

**Files:**
- Modify: `apps/api/src/http/routes/auth.ts`
- Test: `apps/api/src/http/routes/auth_routes.itest.ts`

**Interfaces:**
- Produces: header `X-Zenguy-Client: native`; login/refresh JSON `{ data: { user, accessToken, expiresIn, refreshToken, refreshExpiresIn } }`; refresh body `{ refreshToken }`; logout body `{ refreshToken? }`.

- [ ] **Step 1: Write the failing integration test** (append to the `describe("auth routes")` block)

```ts
  it("serves native clients with body refresh tokens and no cookies", async () => {
    await registerUser(app, "198.51.100.40");
    const verifyResponse = await app.request(
      "/api/auth/verify-email",
      jsonRequest({ token: tokenFromMessage(emails.messages[0]?.text) }),
    );
    expect(verifyResponse.status).toBe(200);

    const native = { "X-Zenguy-Client": "native", "CF-Connecting-IP": "198.51.100.41" };
    const loginResponse = await app.request(
      "/api/auth/login",
      jsonRequest({ email: "alice@example.com", password: "initial-password" }, native),
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("Set-Cookie")).toBeNull();
    const login = (await loginResponse.json()) as NativeSessionResponse;
    expect(login.data.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(login.data.refreshExpiresIn).toBe(2_592_000);

    const refreshResponse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: login.data.refreshToken }, native),
    );
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get("Set-Cookie")).toBeNull();
    const refreshed = (await refreshResponse.json()) as NativeSessionResponse;
    expect(refreshed.data.refreshToken).not.toBe(login.data.refreshToken);

    // Rotation: the old token is revoked; reusing it revokes the family.
    const reuse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: login.data.refreshToken }, native),
    );
    expect(reuse.status).toBe(401);
    expect(reuse.headers.get("Set-Cookie")).toBeNull();
    const afterReuse = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: refreshed.data.refreshToken }, native),
    );
    expect(afterReuse.status).toBe(401);

    const secondLogin = (await (
      await app.request(
        "/api/auth/login",
        jsonRequest({ email: "alice@example.com", password: "initial-password" }, native),
      )
    ).json()) as NativeSessionResponse;
    const logoutResponse = await app.request(
      "/api/auth/logout",
      jsonRequest({ refreshToken: secondLogin.data.refreshToken }, native),
    );
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("Set-Cookie")).toBeNull();
    const afterLogout = await app.request(
      "/api/auth/refresh",
      jsonRequest({ refreshToken: secondLogin.data.refreshToken }, native),
    );
    expect(afterLogout.status).toBe(401);
  });

  it("rejects native refresh without a body token and ignores cookies", async () => {
    const native = { "X-Zenguy-Client": "native" };
    const missing = await app.request("/api/auth/refresh", jsonRequest({}, native));
    expect(missing.status).toBe(400);
    const cookieOnly = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { ...native, Cookie: "zenguy_rt=anything" },
    });
    expect(cookieOnly.status).toBe(400);
  });
```

Add next to `SessionResponse`:

```ts
interface NativeSessionResponse {
  data: SessionResponse["data"] & { refreshToken: string; refreshExpiresIn: number };
}
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/api && pnpm test:integration -- src/http/routes/auth_routes.itest.ts` → the native test fails on `Set-Cookie` not null / missing `refreshToken`.

- [ ] **Step 3: Implement in `auth.ts`**

```ts
const NATIVE_CLIENT_HEADER = "X-Zenguy-Client";
const nativeRefreshSchema = z.object({ refreshToken: z.string().min(1).max(512) });
const nativeLogoutSchema = z.object({ refreshToken: z.string().min(1).max(512).optional() });

function isNativeClient(context: Context<AppEnv>): boolean {
  return context.req.header(NATIVE_CLIENT_HEADER)?.trim().toLowerCase() === "native";
}

async function readNativeBody<T extends z.ZodType>(context: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  try { raw = await context.req.json(); } catch { raw = {}; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validation(parsed.error.issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message })));
  }
  return parsed.data;
}

function nativeSessionPayload(session: AuthSession, refreshMaxAge: number) {
  return { ...sessionPayload(session), refreshToken: session.refreshTokenPlain, refreshExpiresIn: refreshMaxAge };
}
```

In `/login`: `if (isNativeClient(context)) return context.json({ data: nativeSessionPayload(session, refreshMaxAge) });` before setting the cookie. In `/refresh`: branch first — native reads `readNativeBody(context, nativeRefreshSchema)`, executes `refresh.execute`, returns native payload, never touches `Set-Cookie` (also on error). In `/logout`: native reads `nativeLogoutSchema` (`refreshToken ?? null`), calls `logout.execute`, returns 204 with no `Set-Cookie`.

- [ ] **Step 4: Run API gate** — `pnpm --filter @zenguy/api typecheck && pnpm --filter @zenguy/api test && pnpm --filter @zenguy/api test:integration`. Expected: all pass (existing cookie assertions untouched).

- [ ] **Step 5: Commit** — `git add apps/api/src/http/routes/auth.ts apps/api/src/http/routes/auth_routes.itest.ts && git commit -m "API: native-client auth mode for the mobile app"`

---

### Task 2: Scaffold `apps/app`

**Files:** `apps/app/{package.json,.npmrc,.gitignore,app.config.ts,eas.json,babel.config.js,metro.config.js,jest.config.js,jest.setup.ts,tsconfig.json,assets/*}`, `pnpm-workspace.yaml` (add `- "!apps/app"`), root `package.json` (scripts `app:start`, `app:ios`, `app:test`, `app:typecheck`).

**Interfaces:** produces the toolchain every later task runs: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm ios`.

- [ ] Step 1: Write `package.json` with the template versions (`expo ~57.0.15`, `react 19.2.3`, `react-native 0.86.2`, `expo-router ~57.0.15`, `typescript ~6.0.3`, `@types/react ~19.2.2`) plus: `expo-secure-store`, `expo-local-authentication`, `expo-image`, `expo-file-system`, `expo-sharing`, `expo-document-picker`, `expo-clipboard`, `expo-linking`, `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `expo-font`, `expo-haptics`, `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`, `@expo/vector-icons`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`; dev: `jest`, `jest-expo`, `@testing-library/react-native`, `@types/jest`, `babel-plugin-transform-remove-console`.
- [ ] Step 2: `.npmrc` → `node-linker=hoisted` + `ignore-workspace=true`; `pnpm install`; `pnpm exec expo install --fix`; `pnpm exec expo-doctor` (expected: no blocking issues).
- [ ] Step 3: `app.config.ts` — `name: "Zenguy"`, `slug: "zenguy"`, `scheme: "zenguy"`, `platforms: ["ios"]`, `ios.bundleIdentifier: "com.zenguy.app"`, `ios.supportsTablet: false`, `ios.infoPlist: { ITSAppUsesNonExemptEncryption: false, NSFaceIDUsageDescription: "Unlock Zenguy with Face ID." }`, plugins: `expo-router`, `expo-secure-store`, `["expo-local-authentication", { faceIDPermission: "..." }]`, `expo-splash-screen`, `expo-font`.
- [ ] Step 4: `jest.config.js` (`preset: "jest-expo"`, `transformIgnorePatterns` for RN/Expo), smoke test `src/lib/smoke.test.ts` (`expect(1+1).toBe(2)`), `pnpm test` passes; `tsconfig.json` strict with `"paths": {"@/*": ["./src/*"]}`; `pnpm typecheck` passes on an `app/index.tsx` hello screen.
- [ ] Step 5: Assets generated (1024² icon, splash) with a script (`scripts/make-assets.mjs` is optional; `qlmanage`/`sips` acceptable).
- [ ] Step 6: Commit `apps/app` scaffold + `pnpm-workspace.yaml` + root `package.json`.

---

### Task 3: Core libraries (TDD)

**Files:** `src/lib/*.ts` + `*.test.ts`, `src/api/*.ts` (ported from `apps/frontend/src/api/*`).

**Interfaces (produced):**

```ts
// src/lib/config.ts
export const API_ORIGIN: string;                            // no trailing slash
export function resolveApiOrigin(raw: string | undefined, isDev: boolean): string; // throws on non-https when !isDev
// src/lib/secure-storage.ts
export const storageKeys = { refreshToken: "zenguy.refreshToken", lastWorkspace: "zenguy.lastWorkspace", appLock: "zenguy.appLock" } as const;
export const secureStorage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; deleteItem(key: string): Promise<void> };
// src/lib/auth-token.ts — identical to web: setToken(token, expiresInSeconds), getToken(), clearToken(), onExpiringSoon(cb)
// src/lib/api.ts
export class ApiError extends Error { readonly code: string; readonly details?: ApiErrorDetail[]; readonly status: number }
export interface ApiPage<T> { items: T[]; nextCursor: string | null }
export const authEvents: { onSignedOut(cb: () => void): () => void };
export function apiUrl(path: string): string;               // API_ORIGIN + path
export function absoluteArtifactUrl(url: string): string;   // prefixes relative signed URLs
export function apiGet<T>(path): Promise<T>; apiGetPage<T>(path): Promise<ApiPage<T>>; apiPost<T>(path, body?); apiPostText<T>(path, text); apiPatch<T>; apiPut<T>; apiDelete<T = void>(path, body?)
export function apiGetText(path): Promise<{ text: string; filename: string }>;
export function ensureFreshToken(): Promise<RefreshPayload>; // reads refresh token from secureStorage, rotates it
export function storeSession(session: { accessToken; expiresIn; refreshToken }): Promise<void>;
export function clearSession(): Promise<void>;              // clears memory + Keychain
// src/lib/links.ts
export function parseLinkToken(value: unknown): string | null;   // ^[A-Za-z0-9_-]{1,512}$
export function workspaceHref(wsId: string, sub?: string): string; // `/w/${wsId}/${sub ?? "overview"}`
// src/lib/errors.ts, src/lib/format.ts, src/lib/permissions.ts — ported verbatim with their tests
// src/lib/share.ts
export function shareTextFile(filename: string, text: string, mimeType: string): Promise<void>; // expo-file-system cache + expo-sharing
```

- [ ] Step 1: Port `format.ts`, `permissions.ts`, `errors.ts` with the web tests (`apps/frontend/src/lib/*.test.ts`, adapted from vitest to jest: `import { describe, expect, it } from "@jest/globals"` is optional; jest globals are available).
- [ ] Step 2: `config.test.ts` — `resolveApiOrigin("https://api.zenguy.com/", false)` → no trailing slash; `resolveApiOrigin("http://x", false)` throws; `resolveApiOrigin(undefined, true)` → `http://127.0.0.1:8787`.
- [ ] Step 3: `api.test.ts` with `global.fetch` mocked and `expo-secure-store` mocked (jest.mock): (a) GET sends bearer + native header only on auth paths… (native header sent on ALL requests is also acceptable — pick: send on all requests); (b) 401 → refresh via body token → retry once; (c) refresh failure → `authEvents` fires, Keychain cleared; (d) `apiGetPage` unwraps `nextCursor`; (e) non-JSON error → `ApiError("Request failed", INTERNAL)`; (f) `apiGetText` parses `Content-Disposition`.
- [ ] Step 4: `links.test.ts` — accepts `abc_-1`, rejects `""`, `"a b"`, 600-char strings, non-strings.
- [ ] Step 5: Port `src/api/*` modules: replace `apiGetBlob` usages with `apiGetText` (`exportTests`, `downloadReport` return `{ text, filename }`); `auth.ts` `login` calls `storeSession`, `logout` posts `{ refreshToken }` then `clearSession`.
- [ ] Step 6: `pnpm test && pnpm typecheck`; commit.

---

### Task 4: Theme, UI kit, domain components

**Files:** `src/theme/*`, `src/ui/*`, `src/components/{StatusBadge,RunSourceBadge,UsageMeter,CopyButton,RoleBadge,AuthShell,PrivacyShield}.tsx`, tests for `StatusBadge`, `UsageMeter` (usageTone), `Button` (loading disables press).

**Interfaces (produced):**

```ts
// src/theme/index.ts
export const colors = { bg: "#fafafa", surface: "#ffffff", border: "#e4e4e7", text: "#18181b", textMuted: "#71717a", textSubtle: "#a1a1aa",
  accent: "#4f46e5", accentDark: "#4338ca", accentSoft: "#eef2ff", ok: "#059669", okSoft: "#ecfdf5", okDark: "#047857",
  danger: "#dc2626", dangerSoft: "#fef2f2", dangerDark: "#b91c1c", warn: "#d97706", warnSoft: "#fffbeb", info: "#2563eb", infoSoft: "#eff6ff",
  zinc50: "#fafafa", zinc100: "#f4f4f5", zinc200: "#e4e4e7", zinc300: "#d4d4d8", zinc500: "#71717a", zinc600: "#52525b", zinc700: "#3f3f46", zinc800: "#27272a", zinc900: "#18181b", zinc950: "#09090b" };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 8, lg: 12, full: 999 };
export const typography = { title: { fontSize: 22, fontWeight: "600" }, heading: { fontSize: 17, fontWeight: "600" }, body: { fontSize: 15 }, small: { fontSize: 13 }, caption: { fontSize: 12 }, mono: { fontFamily: "Menlo", fontSize: 13 } };
export type Tone = "neutral" | "accent" | "ok" | "danger" | "warn" | "info";

// src/ui (all accept `style?`):
Screen({ children, scroll?: boolean = true, refreshing?, onRefresh?, padded?: boolean = true, keyboard?: boolean })
Card({ title?, children, padding?: "md" | "none" | "sm", tone?: "neutral" | "danger" | "ok" | "info" | "warn" })
Button({ title, onPress, variant?: "primary" | "secondary" | "danger" | "ghost", size?: "md" | "lg", loading?, disabled?, icon?: ReactNode, fullWidth? })
Input(TextInputProps & { invalid?: boolean })  PasswordInput(same)  Field({ label, error?, hint?, required?, children })
Badge({ children, tone?: Tone, pulse?: boolean })  ListRow({ title, subtitle?, left?, right?, onPress?, chevron?, destructive? })
EmptyState({ title, description?, action?: ReactNode })  ErrorState({ message?, onRetry?, retryLabel? })  Spinner({ label?, size?: "small" | "large" })
Skeleton({ height?, width? })  SegmentedTabs({ items: {key,label}[], value, onChange })  SelectSheet({ label?, value, options: {label,value}[], onChange, invalid? })
Toggle({ value, onValueChange, label?, description? })  DescriptionList({ items: {label, value: ReactNode}[] })
Text variants: <Title/>, <Heading/>, <Body/>, <Muted/>, <Caption/>, <Mono/>  Divider()  LoadMore({ loading, nextCursor, onMore })
ActionMenu({ items: { label, onSelect, destructive?, disabled? }[], trigger?: ReactNode })  // ActionSheetIOS
confirm({ title, message?, confirmLabel?, destructive? }): Promise<boolean>       // Alert.alert
```

- [ ] Steps: write tokens → primitives → tests (`StatusBadge` renders "Passed after retry"; `usageTone` thresholds; `Button` ignores presses while loading) → `pnpm test && pnpm typecheck` → commit.

---

### Task 5: Contexts, root layout, guards, app lock, tabs skeleton

**Files:** `src/contexts/*`, `src/hooks/useMutationError.ts`, `src/components/AppLockGate.tsx`, `app/_layout.tsx`, `app/index.tsx`, `app/(auth)/_layout.tsx`, `app/w/[wsId]/_layout.tsx`, `app/w/[wsId]/(tabs)/_layout.tsx` and the four group `_layout.tsx` stacks with placeholder screens; tests: `AuthContext.test.tsx` (bootstrap: refresh ok → signedIn; refresh fails → signedOut), `WorkspaceContext.test.ts` (`resolveWorkspace`, `requiresBillingSetup`), `AppLock` reducer test (`shouldLock(lastActiveAt, now, threshold)`).

**Interfaces (produced):**

```ts
useAuth(): { status: "loading" | "signedOut" | "signedIn"; user: User | null; signIn(email, password): Promise<User>; signOut(): Promise<void>; refreshUser(): Promise<User> }
useWorkspace(): { can(action: Action): boolean; current: Workspace; role: Role; subscriptionStatus; timezone: string; workspaces: Workspace[] }
useToast(): { success(msg), error(msg), info(msg) }
useAppLock(): { enabled: boolean; threshold: AppLockThreshold; biometricsAvailable: boolean; setEnabled(v): Promise<void>; setThreshold(v): Promise<void>; locked: boolean; unlock(): Promise<void> }
export type AppLockThreshold = "immediate" | "1m" | "5m";
useMutationError(): (error: unknown) => boolean   // toast + router.push(`/w/${id}/setup/billing`) on 402
```

Guards: `app/(auth)/_layout.tsx` → `<Redirect href="/" />` when signedIn; `app/w/[wsId]/_layout.tsx` → `<Redirect href="/(auth)/sign-in" />` when signedOut, `/verify-pending` when unverified; `WorkspaceProvider` → `/onboarding/workspace` when no workspaces, `NotFound` picker when the id is unknown, `/w/[id]/setup/billing` when `requiresBillingSetup`.

Tabs: `overview` (Ionicons `grid-outline`), `(tests)` (`globe-outline`), `(uptime)` (`pulse-outline`), `(incidents)` (`alert-circle-outline`), `(more)` (`ellipsis-horizontal-circle-outline`); active tint `colors.accent`.

- [ ] Steps: contexts with tests → layouts → `pnpm typecheck && pnpm test` → `pnpm exec expo export --platform ios` bundles without error → commit.

---

### Task 6: Auth + onboarding + legal screens

**Mirror:** `apps/frontend/src/pages/auth/*.tsx`, `pages/onboarding/CreateWorkspace.tsx`, `pages/legal/*.tsx`, `pages/auth/useResendVerification.ts`.
**Files:** `app/(auth)/*.tsx`, `app/verify-email.tsx`, `app/verify-pending.tsx`, `app/invitations/[token].tsx`, `app/onboarding/workspace.tsx`, `app/privacy.tsx`, `app/terms.tsx`, `src/components/{AuthShell,TimezonePicker}.tsx`, `src/hooks/useResendVerification.ts`; tests for schemas (`signInSchema`, `signUpSchema` password confirmation, `createWorkspaceSchema`), `defaultWorkspaceName`, `filterTimezones`, `invitationAccessMode`, `createTokenVerifier`.
- [ ] Acceptance: same validation messages as web; `INVALID_CREDENTIALS` and `RATE_LIMITED` inline; after sign-in navigate to `next` param or `/`; sign-up → `check-email?email=`; verify-pending polls `/me` every 10 s and redirects when verified; reset/verify accept `token` from `useLocalSearchParams()` through `parseLinkToken`.

### Task 7: Overview, Browser Tests, Runs

**Mirror:** `pages/overview/OverviewPage.tsx`, `pages/tests/*.tsx`, `components/{RunStatusPanel,AttemptDetail,ScreenshotViewer}.tsx`, `pages/tests/hooks.ts`.
**Files:** `app/w/[wsId]/(tabs)/overview.tsx`, `(tests)/tests/{index,new}.tsx`, `(tests)/tests/[testId]/{index,edit}.tsx`, `(tests)/runs/[runId].tsx`, `src/components/{RunStatusPanel,AttemptDetail,ScreenshotViewer,ChannelPicker}.tsx`, `src/hooks/useRunNow.ts`; tests: `activityPath`, `defaultExpandedAttemptId`, `importErrorMessage`, `parseRunFilter`, `testFormSchema`, `retryOptionLabel`, `isTerminalRun`.
- [ ] Acceptance: list with pull-to-refresh and row menu (Open / Run now / Edit / Delete per permission); form with device selector, interval, retries, channel picker, "Test it" (validateDraft → RunStatusPanel compact); detail with summary cards, configuration, runs with status filter + load more; run detail with live polling, attempts accordion, steps timeline, screenshot viewer (full-screen modal with prev/next), console/network/visited disclosures, "Download report" via `shareTextFile`; export via share sheet; import via `expo-document-picker`.

### Task 8: Uptime

**Mirror:** `pages/uptime/*.tsx`, `components/{KeyValueEditor,RecoveryToggle}.tsx`.
**Files:** `(uptime)/uptime/{index,new}.tsx`, `(uptime)/uptime/[monitorId]/{index,edit}.tsx`, `src/components/{KeyValueEditor,ResponseTimeChart}.tsx`; tests: `monitorFormSchema` (body condition rules), `toMonitorInput`, `monitorToFormValues`, `monitorHost`, `uptimeTone`, `expectationSummary`.
- [ ] Acceptance: full form (name, method, URL, headers editor, body, expected status, body condition + value/path, frequency, timeout, retries, channels, notify on recovery, "Send test request" with result card); detail with UP/DOWN badge, stats cards, 24 h bar chart (View-based), checks list with load more, incidents, configuration, delete.

### Task 9: Incidents + Notifications

**Mirror:** `pages/incidents/*.tsx`, `components/IncidentTimeline.tsx`, `pages/notifications/*.tsx`, `components/EmailListInput.tsx`.
**Files:** `(incidents)/incidents/{index}.tsx`, `(incidents)/incidents/[incidentId].tsx`, `(more)/notifications/index.tsx`, `(more)/notifications/[channelId]/deliveries.tsx`, `src/components/{IncidentTimeline,ChannelForm,EmailListInput}.tsx`; tests: `parseIncidentStatus/Type`, `liveIncidentDuration`, `channelFormSchema`, `channelConfigFromValues`, `channelTarget`, `testDeliveryResult`.
- [ ] Acceptance: incidents with status segmented tabs + type filter + load more; detail timeline + deliveries; channels as cards with menu (Send test / View deliveries / Enable-Disable / Edit / Delete), create/edit modal per type (EMAIL list, SMS/WHATSAPP/CALL phone + consent, SLACK/DISCORD webhook), deliveries list.

### Task 10: Secrets + Members

**Mirror:** `pages/secrets/SecretsPage.tsx`, `components/DomainListInput.tsx`, `pages/members/MembersPage.tsx`.
**Files:** `(more)/secrets/index.tsx`, `(more)/members/index.tsx`, `src/components/{DomainListInput,SecretForm,RoleBadge}.tsx`; tests: `secretFormSchema` modes, `createSecretInput`, `memberActionPolicy`, `inviteSchema`.
- [ ] Acceptance: secrets never show values; create (key/value/domains/description), replace value, edit domains, delete with confirm; members list with role badges, change role / remove per policy, invite (email+role), pending invitations with revoke.

### Task 11: Billing, Settings, Account, grants, billing setup

**Mirror:** `pages/billing/*.tsx`, `pages/settings/SettingsPage.tsx`, `pages/onboarding/BillingSetup.tsx`, `components/Sidebar.tsx` (account menu), `WorkspaceSwitcher.tsx`.
**Files:** `(more)/more/index.tsx`, `(more)/billing/index.tsx`, `(more)/settings/index.tsx`, `(more)/account/index.tsx`, `app/w/[wsId]/setup/billing.tsx`, `app/grants/[token].tsx`, `app/complimentary.tsx`; tests: `subscriptionPresentation`, `planPresentation`, `transferCandidates`, `prettyAuditMetadata`, `workspaceSettingsSchema`.
- [ ] Acceptance: More menu with workspace switcher (SelectSheet) + create workspace; billing read-only (plan, usage meter, invoices list, "Manage billing on the web" when paddle); settings general form, audit log with load more, danger zone (transfer ownership picker, delete with name confirmation); account: user, app lock toggle + threshold, sign out, privacy/terms links; billing setup handles free mode activation (`GET /api/workspaces/:id/billing` → active) and paddle mode message.

### Task 12: Integration, native build, smoke, docs

- [ ] `pnpm typecheck && pnpm test && pnpm lint` in `apps/app`.
- [ ] `pnpm exec expo prebuild --platform ios --clean` then `pnpm exec expo run:ios --device "iPhone 17"` (or `xcodebuild -workspace ios/Zenguy.xcworkspace -scheme Zenguy -sdk iphonesimulator`). Expected: app boots on the simulator.
- [ ] Smoke against local API (`wrangler dev` on 8787, seeded): sign in `marcos@aguayo.es` / `abc123456`; open overview, tests, a run, uptime monitor, incidents, more → members; capture screenshots with `xcrun simctl io booted screenshot`.
- [ ] `apps/app/README.md` (setup, env, security model, EAS/TestFlight), root README repo layout row, root scripts; commit.
