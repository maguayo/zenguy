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
  navigate outside the app. Link bearers are captured in bounded process
  memory, removed from Expo's cached launch URL and replaced with token-free
  continuation routes before use; they are never placed in React Query keys or
  login `next` parameters. Newly issued links carry the capability in a URL
  fragment (not sent to CDN/origin/Referer), and preview/consume APIs receive it
  in a POST body rather than the request path. HTTPS links on `app.zenguy.com` are verified by the
  versioned AASA file and the `applinks:` entitlement. The final config plugin
  removes Expo's implicit bundle-id URL scheme from generated `Info.plist`, so
  the app registers no claimable custom scheme. No analytics or third-party
  SDKs. `console.*` is stripped from release bundles.

- **Forced updates**: on launch and on every return to the foreground the app
  reads `GET /api/app/version` (`minVersion`, `storeUrl`). A build older than
  `minVersion` is covered by a blocking "Update required" screen with an
  "Open the App Store" button (only `https://apps.apple.com` links are opened).
  To force an update, bump `MIN_APP_VERSION` in
  `apps/api/src/shared/constants.ts` and deploy the API; set the
  `IOS_APP_STORE_URL` var per environment once the app is published. Network
  failures never block the app.

Not covered (documented decisions): certificate pinning and jailbreak
detection. Universal Links require the AASA file from
`apps/frontend/public/.well-known/apple-app-site-association` to be deployed on
`app.zenguy.com` before installing the new binary.

## Push notifications

Alerts also arrive as push notifications (free, every workspace member with the
app). The app side (`src/contexts/PushContext.tsx`):

- After the first workspace loads, a soft prompt ("Get alerts on this iPhone")
  precedes the iOS permission dialog; "Not now" keeps quiet until the next
  launch. Account → Notifications shows the permission state, an "Open
  Settings" shortcut when denied, and a per-device switch.
- With permission granted the app registers its Expo push token with
  `PUT /api/me/push-devices` on every launch and whenever the token changes,
  and calls `DELETE /api/me/push-devices/:id` right before signing out (the
  session must still be valid). The API creates the default "Mobile push"
  channel (`type: "PUSH"`) for the user's workspaces.
- Tapping a notification opens its `data.url` only when it is a
  verified `https://app.zenguy.com/w/<workspace>/…` Universal Link
  (`src/lib/push.ts`); anything else is ignored.
- Foreground notifications still show as banners.

It only works on a physical iPhone running an EAS build (see *Deploy to App
Store*): the simulator cannot receive APNs and reports push as unavailable, and
the `expo-notifications` plugin sets `aps-environment` to production for the
  `production` profile. The entitlement is set explicitly in `app.config.ts`
  because Expo can auto-apply the notifications plugin before its configured
  plugin instance.

## Configuration

| Setting | Where | Values |
| --- | --- | --- |
| API origin | `EXPO_PUBLIC_API_ORIGIN` (`.env.local`, `eas.json` profiles) | dev `http://127.0.0.1:8787`, preview `https://api-staging.zenguy.com`, production `https://api.zenguy.com` |
| Bundle id / links | `app.config.ts` | `com.zenguy.app`, verified Universal Links only |
| Reproducible iOS builder | `eas.json` | `macos-tahoe-26.5-xcode-26.6` for every profile |
| Face ID usage text, ATS | `app.config.ts` → `ios.infoPlist` | |

The app has no secrets of its own.

## Deploy to App Store

Everything needed to ship `apps/app` to TestFlight and, later, to the public
App Store. The native project (`ios/`) is generated by `expo prebuild` and
git-ignored; EAS builds it in the cloud from the committed sources.

### Identity (verify before creating or submitting anything)

| What | Value |
| --- | --- |
| Apple organization | **Niesayo Group SL**, Team ID `HT84Q65URB` (Account Holder: Raquel; Marcos is Admin in App Store Connect) |
| App ID / bundle id | `com.zenguy.app` (capability: Push Notifications) |
| App Store Connect record | "Zenguy", Apple ID **6804201911**, SKU `zenguy-ios`, primary language English (U.S.) → `submit.production.ios.ascAppId` in `eas.json` |
| TestFlight | internal group **Zenguy Internal** with Apple's *automatic distribution* on. Because Apple assigns builds, `submit.production.ios.groups` must stay unset (never both mechanisms) |
| Expo / EAS | account `maguayo`, project **@maguayo/zenguy** (`dbac86d4-6e5f-4cb1-b465-4182ccb5cac7`), channels `production`, `preview`, `development` |
| Apple agreements | Free Apps Agreement (active until 2027-07-15, renewed yearly by the Account Holder) and the Digital Services Act trader status (App Store Connect → Business → Agreements). Both must be *Active* or submissions and EU availability fail |

| Profile (`eas.json`) | Channel / environment | Distribution | API origin |
| --- | --- | --- | --- |
| `development` | `development` | internal, dev client, simulator | `https://api-staging.zenguy.com` |
| `preview` | `preview` | internal (ad hoc) | `https://api-staging.zenguy.com` |
| `production` | `production` | App Store / TestFlight | `https://api.zenguy.com` |

### 1. Deploy the API first

The production build talks to `https://api.zenguy.com` only. Every push to
`main` runs `.github/workflows/production.yml` (API typecheck → unit tests →
integration tests → D1 migrations → Worker deploy). A build is only useful once
the API it needs is live: native auth mode (`X-Zenguy-Client: native`),
`GET /api/app/version`, `PUT /api/me/push-devices`, the alerts routes.

```bash
git push origin main
gh run watch                                   # or: gh run list --workflow=production.yml --limit 1
curl -s https://api.zenguy.com/api/app/version # { data: { minVersion, storeUrl } }
```

The forced-update floor is `MIN_APP_VERSION` in `apps/api/src/shared/constants.ts`;
raise it (and deploy) only when every older build must stop working, and set the
production var `IOS_APP_STORE_URL` (an `https://apps.apple.com/…` URL) once the
app is public so the blocking screen can open the store.

### 2. Credentials (one-time; repeat only to renew)

They live in EAS, never in this repository:
https://expo.dev/accounts/maguayo/projects/zenguy/credentials → `com.zenguy.app`.

| Credential | Scope | Current value | Notes |
| --- | --- | --- | --- |
| Apple Distribution certificate | whole team (shared with the other Niesayo apps) | serial `6A5F4472F596BA3F5C6E50D700221A8`, expires **2027-07-25** | Apple allows 3 per team |
| Provisioning profile (App Store) | this app | `YNK325M2FS` | regenerated automatically when the certificate or a capability changes |
| Apple Push Notifications key (APNs) | whole team (shared) | key ID `8UDV42545G` | Apple allows 2 per team; required by `expo-notifications` |
| App Store Connect API key | team | key ID `U3MR73JGPS` | lets `eas submit` upload without an Apple login |

How they were set up, and how to redo it (interactive only — EAS needs a human
to type the Apple password and the 2FA code, so this cannot run from CI or an
agent):

```bash
cd apps/app
pnpm exec eas credentials --platform ios
```

1. Profile: `production`. Log in with an Apple ID that is Admin or Account
   Holder of Niesayo Group SL; confirm team `HT84Q65URB` when asked.
2. *Build Credentials* → *All: Set up all the required credentials* →
   **reuse** the existing distribution certificate (answer `Y`) → generate the
   provisioning profile (`Y`).
3. *Go back* → *Push Notifications* → reuse the existing key (or set up a new
   one if none is offered).
4. *Go back* → *App Store Connect: Manage your API Key* → reuse the existing
   key (or generate one).
5. *Exit*. Check the Expo credentials page shows all four rows.

Rules: never pick a *Delete*, *Remove* or *Revoke* option — the certificate and
the APNs key also sign and push Larvai and Dailyer. To renew the certificate
before 2027-07-25 create the new one first, regenerate profiles, ship a build,
and revoke the old one only after every app has moved. `.p8`, `.p12`, `.cer`,
`.mobileprovision` and `credentials.json` are git-ignored; keep them out of
chats and logs.

### 3. Validate locally

```bash
cd apps/app
pnpm install
pnpm verify:release-config              # introspects every native profile
pnpm typecheck && pnpm lint && pnpm test
pnpm doctor                           # expo-doctor
pnpm exec expo install --check        # dependency versions for SDK 57
```

### 4. Version

`version` in `app.config.ts` and `package.json` is the public App Store version;
the release guard requires them to match. Runtime
compatibility uses `runtimeVersion.policy = fingerprint`, so native modules,
plugins, permissions and entitlements automatically produce a different OTA
runtime. Bump the public version deliberately for each commercial release and
whenever a release must be enforced through `MIN_APP_VERSION`. The build number is remote and auto-incremented
(`appVersionSource: remote`, `autoIncrement: true`); inspect or fix it with
`pnpm exec eas build:version:get --platform ios` / `build:version:set`.

### 5. Build and send to TestFlight

First create the GitHub environment `ios-production-release`, require an
independent reviewer, restrict deployment to protected tags, and add only the
environment secret `EXPO_IOS_RELEASE_TOKEN`. Use a dedicated Expo access token
that is not reused by OTA. Protect `ios-v*` tags against deletion or movement.

The preferred production path is `.github/workflows/ios-release.yml`: on the
current `main` commit, push the exact tag `ios-v<package version>` (for example
`ios-v0.2.2`) or dispatch the workflow while viewing that tag, then approve the
protected `ios-production-release` environment. The workflow verifies the tag
against `package.json` and the live GitHub API `main` head both before and after
tests, installs the frozen app lockfile, introspects all native profiles, and
builds the reviewed commit with frozen credentials and a fully pinned EAS
image/CLI/Node/pnpm toolchain. Keep the command below only as an audited
operator fallback.

```bash
cd apps/app
pnpm exec eas build --platform ios --profile production \
  --auto-submit --non-interactive --wait --freeze-credentials
```

What happens: EAS refuses a dirty worktree (`cli.requireCommit: true`), builds
the reviewed commit with the stored credentials, submits
with the App Store Connect API key, then Apple processes the binary (5–30
minutes). Export compliance is answered by `ITSAppUsesNonExemptEncryption:
false` (only standard TLS), so no questionnaire appears. When the build shows
*Ready to Test* in App Store Connect → TestFlight → iOS, "Zenguy Internal"
receives it automatically and testers install it from the TestFlight app.

- Progress: `pnpm exec eas build:list --platform ios --limit 3`,
  https://expo.dev/accounts/maguayo/projects/zenguy/builds and
  `…/submissions`.
- Re-submit an existing build: `pnpm exec eas submit --platform ios --profile production --latest`.
- A preview build for internal devices: `--profile preview` (ad hoc; each
  device UDID must be registered with `eas device:create`).

### 6. OTA updates (JavaScript-only fixes)

`eas update` reaches installed builds with the exact native fingerprint; never
use it for native changes (see step 4). Updates are accepted only when signed
by `certs/updates-certificate.pem` using key id `zenguy-2026-01`. The public
certificate is RSA-2048, SHA-256 fingerprint
`88:2A:06:F4:85:BF:16:0F:3F:F2:63:E8:2E:26:8A:DC:B0:00:51:8D:40:99:0E:B2:D4:2F:22:47:A0:F8:5D:10`,
valid through 2036-08-20.

Create a separate GitHub environment `ios-production-ota` with an independent
reviewer and protected-tag restriction. It contains only
`EXPO_IOS_OTA_TOKEN` and `EAS_UPDATE_PRIVATE_KEY_PEM`; neither secret belongs in
the build environment. The preferred path is `.github/workflows/ios-ota.yml`:
create a protected `ios-ota-v<package version>-<positive sequence>` tag (for
example `ios-ota-v0.2.2-1`), approve `ios-production-ota`, and let CI install
the frozen lockfile, run all mobile checks, re-check the live `main` head before
each credential boundary, verify that the signing key matches the versioned
public certificate, and publish with the pinned EAS CLI. The private key exists
on the runner only for that job and is removed in an `always()` cleanup step.
Keep a separate recovery copy in the approved secret-manager vault.

The matching local private key is deliberately ignored at
`credentials/updates-private-key.pem`. The command below is only an audited
operator fallback; keep that file at mode `0600` and never copy it into the
repository.

```bash
pnpm exec eas update --channel production --environment production \
  --private-key-path credentials/updates-private-key.pem --message "<what changed>"
pnpm exec eas channel:view production
```

To rotate the OTA key, generate a new offline key/certificate and key id, ship
a new binary embedding that public certificate first, and retain the old key
for the old runtime until it no longer needs updates. Never overwrite the
vault's only recovery copy. `pnpm verify:release-config` enforces public/private
key hygiene, the embedded fingerprint, certificate lifetime and local `0600`
permissions.

### Remote controls still required

Local configuration cannot complete these controls:

1. Deploy `apps/frontend/public/.well-known/apple-app-site-association` unchanged at
   `https://app.zenguy.com/.well-known/apple-app-site-association` with HTTP
   200, no redirect and `application/json`; then reinstall a production-profile
   build and smoke-test all five approved path families on a physical iPhone.
2. Create and protect the two GitHub environments and their three isolated
   secrets described above; protect the exact release/OTA tag families and
   require review for changes to workflows, app signing config and certificates.
3. Confirm EAS still has the distribution certificate, App Store profile, APNs
   key and App Store Connect API key listed in step 2 before the first guarded
   build. The workflows freeze rather than replace credentials.
4. Complete TestFlight/App Store Connect metadata, privacy answers, screenshots,
   review account and manual public release described below. None of these
   settings are changed by repository code.

### 7. Public App Store release (not done yet)

TestFlight and the public store are separate phases. Before *Submit for
Review* in App Store Connect: App Information (privacy policy
https://app.zenguy.com/privacy, support URL, category), App Privacy (data
collected: account email and name, diagnostics), age rating, iPhone
screenshots (6.9" and 6.5"; `supportsTablet` is `false`), description,
keywords, review notes with a demo account, pricing *Free* and availability.
Prefer manual release after approval, then set `IOS_APP_STORE_URL` (step 1).

### Troubleshooting

- *Invalid username and password* at `eas credentials`: EAS logs into Apple
  with the Apple ID you type; use the team member's own Apple ID and its 2FA
  code. Passwords go to Apple only and are cached in the macOS keychain.
- *Build number already used*: `pnpm exec eas build:version:set --platform ios` to a higher value.
- Submission rejected for agreements or trader status: App Store Connect →
  Business → Agreements (Account Holder only).
- Push not received: physical iPhone only, `aps-environment` must be
  `production` in the build (the `expo-notifications` plugin sets it for the
  `production` profile), and the device must appear under Account →
  Notifications in the app.

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
