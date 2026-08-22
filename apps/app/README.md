# Zenguy iOS app (`apps/app`)

Native iOS client for Zenguy built with Expo SDK 57 and expo-router. It offers
the same product surface as the web application (`apps/frontend`): sign-in and
sign-up, workspaces, overview, browser tests and runs with evidence, uptime
monitors, incidents, notification channels, secrets, members, plan & usage and
workspace settings — against the same API (`apps/api`).

Design and decisions: `docs/superpowers/specs/2026-08-21-mobile-app-design.md`.
Conventions for contributors: `CONTRIBUTING.md`.

## Requirements

- Node 22+, pnpm 10+ (the app is its own pnpm root with hoisted `node_modules`;
  it is excluded from the monorepo workspace on purpose).
- Xcode 16+ with an iPhone simulator, CocoaPods (`brew install cocoapods`).
- A running API: the local Wrangler API (`pnpm --filter @zenguy/api dev`) or the
  staging API.

## Run it

```bash
cd apps/app
pnpm install
cp .env.example .env.local          # EXPO_PUBLIC_API_ORIGIN=http://127.0.0.1:8787
pnpm ios                            # expo prebuild + build + launch on a simulator
# or, once the native project exists:
pnpm start                          # Metro only; press i for the simulator
```

Use `EXPO_PUBLIC_API_ORIGIN=https://api-staging.zenguy.com` to run the simulator
against staging. A physical iPhone cannot reach `127.0.0.1`; use your Mac's LAN
IP for the local API (cleartext is only allowed for local addresses in
development builds).

The local test account from the API seed works here too
(`marcos@aguayo.es` / `abc123456`).

## Checks

```bash
pnpm typecheck
pnpm test              # jest (jest-expo)
pnpm lint
pnpm doctor            # expo-doctor
CI=1 pnpm exec expo export --platform ios --output-dir /tmp/zenguy-export   # Metro bundle check
```

## How the session works (security model)

- **Native auth mode.** Every request carries `X-Zenguy-Client: native`. On
  `/api/auth/*` the API then returns the refresh token in the JSON body instead
  of a browser cookie (`apps/api/src/http/routes/auth.ts`).
- **Access token** (JWT, 30 min) lives in memory only and is refreshed a minute
  before expiry or after a `401`.
- **Refresh token** (30 days, rotated on every use, reuse detection server-side)
  is stored in the iOS Keychain through `expo-secure-store` with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: readable only while the device is unlocked,
  never synced to iCloud Keychain, never included in backups.
- Sign-out revokes the token on the server and wipes it locally even if the
  network call fails; a rejected refresh token signs the user out and clears
  the Keychain. Being offline never wipes the session.
- Nothing from a workspace is persisted: the React Query cache is memory only.
  The only stored values are the last workspace id and the App Lock preference
  (both in the Keychain).
- **App Lock** (Account → App Lock): Face ID / Touch ID / passcode when the app
  returns from the background after a configurable delay.
- **Privacy shield**: the UI is covered whenever the app is inactive so the app
  switcher never shows workspace data.
- **Transport**: App Transport Security defaults (HTTPS only); release builds
  refuse a non-`https` `EXPO_PUBLIC_API_ORIGIN`. Local cleartext is allowed only
  for localhost / private addresses in development builds.
- Deep-link parameters are validated (`src/lib/links.ts`) and never used to
  navigate outside the app. No analytics or third-party SDKs. `console.*` is
  stripped from release bundles.

- **Forced updates**: on launch and on every return to the foreground the app
  reads `GET /api/app/version` (`minVersion`, `storeUrl`). A build older than
  `minVersion` is covered by a blocking "Update required" screen with an
  "Open the App Store" button (only `https://apps.apple.com` links are opened).
  To force an update, bump `MIN_APP_VERSION` in
  `apps/api/src/shared/constants.ts` and deploy the API; set the
  `IOS_APP_STORE_URL` var per environment once the app is published. Network
  failures never block the app.

Not covered (documented decisions): certificate pinning, jailbreak detection,
push notifications, universal links (needs an AASA file on `app.zenguy.com`;
the `zenguy://` scheme works today, e.g. `zenguy://verify-email?token=…`).

## Configuration

| Setting | Where | Values |
| --- | --- | --- |
| API origin | `EXPO_PUBLIC_API_ORIGIN` (`.env.local`, `eas.json` profiles) | dev `http://127.0.0.1:8787`, preview `https://api-staging.zenguy.com`, production `https://api.zenguy.com` |
| Bundle id / scheme | `app.config.ts` | `com.zenguy.app`, `zenguy` |
| Face ID usage text, ATS | `app.config.ts` → `ios.infoPlist` | |

The app has no secrets of its own.

## Building and releasing (EAS)

The native project (`ios/`) is generated (`expo prebuild`) and git-ignored.

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli init                       # links the project; stores projectId in app.config.ts
pnpm dlx eas-cli build -p ios --profile development   # simulator build
pnpm dlx eas-cli build -p ios --profile preview       # internal distribution against staging
pnpm dlx eas-cli build -p ios --profile production    # App Store build against production
pnpm dlx eas-cli submit -p ios                        # TestFlight / App Store Connect
```

Before the first store submission: set the Apple Team in EAS credentials,
provide the privacy policy URL (https://app.zenguy.com/privacy) and the
support URL in App Store Connect, and keep `ITSAppUsesNonExemptEncryption`
false (only standard TLS is used).

## Structure

```
app/                        expo-router routes (URLs mirror the web app)
src/api/                    API clients + types (ported from apps/frontend)
src/lib/                    api client, config, secure storage, links, format, share, timezones
src/contexts/               Auth, Workspace, Toast, AppLock
src/ui/                     UI primitives
src/components/             domain components (+ per-area folders)
src/theme/                  design tokens
```
