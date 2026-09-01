# App Review account contract

Prepare this account in production only after migrations and the public release
prerequisites are deployed. Use the ordinary web product and API; do not enable
remote seed code, copy the local seed password, write directly to D1 or add a
review-only bypass to the application.

## Identity and access

- Use a dedicated monitored mailbox that can receive verification and password
  reset mail. It must not be a personal or customer address.
- Generate a unique password in the approved password manager. Store it only in
  that vault and App Store Connect Sign-In Information.
- Verify the email and keep exactly one production workspace with `ACTIVE`
  access. Give the account Owner or Admin role so Apple can inspect AI data
  sharing. Do not enable 2FA or any expiring access policy for this identity.
- Ensure two simultaneous logins remain valid. Do not reuse the account for
  ordinary staff activity or deletion testing.

## Deterministic demo data

The single workspace must use fictional, non-customer content and contain:

- Overview activity, usage, at least two browser tests and one uptime monitor;
- exactly one **Blog listing** test whose newest run is complete and contains
  step screenshot evidence from a controlled `zenguy.com` or reserved
  `example.com` target;
- exactly one **Search filters** browser test and one incident for it with a
  useful timeline;
- exactly one **Status API** monitor with recent checks and response-time
  history;
- at least one enabled notification channel, using only Push to workspace
  members or the dedicated review mailbox; and
- a Members list containing only the review identity and, if needed, dedicated
  plus-address aliases of that same mailbox for fictional teammates.

Optional OpenAI processing must remain pristine and off: no accepted or revoked
consent history. Never show customer domains, real people, phone numbers,
webhooks, secret values, payment state or known credentials from
`apps/api/scripts/seed.mjs`.

## Read-only verification

Inject `MAESTRO_REVIEW_EMAIL` and `MAESTRO_REVIEW_PASSWORD` into the process
through the approved password manager. Do not type literal values in a command,
shell history or file. Then run from `apps/app`:

```bash
pnpm verify:app-review-account
```

The verifier targets only `https://api.zenguy.com`, rejects committed local
fixture identities/passwords, signs in twice, proves both sessions remain
valid, checks every named view, validates the `id`/`exp`/`sig` contract of the
screenshot evidence, proves that one signed image can be loaded and logs out
both sessions. It never changes workspace data and never prints email,
password, access tokens, refresh tokens, IDs or signed artifact URLs; downloaded
evidence bytes are discarded immediately.

Run it immediately before the screenshot flow and again before entering the
credentials in App Store Connect. A green result proves the API contract and
demo content at that moment; it does not replace the physical-device smoke test
or the final 100% visual review.

## Ephemeral App Review metadata

The tracked `apps/app/store.config.json` intentionally contains only public,
non-secret metadata. `apps/app/store.review.config.cjs` overlays the App Review
contact, sign-in information and the canonical notes in memory. Have the
approved password manager inject all eight variables directly into each child
process:

```text
APP_REVIEW_CONTACT_FIRST_NAME
APP_REVIEW_CONTACT_LAST_NAME
APP_REVIEW_CONTACT_EMAIL
APP_REVIEW_CONTACT_PHONE
APP_REVIEW_SCREEN_RECORDING_FILENAME
APP_REVIEW_TESTED_DEVICES
MAESTRO_REVIEW_EMAIL
MAESTRO_REVIEW_PASSWORD
```

Never `export` their values into an interactive shell or place them in command
arguments, shell history, `.env` files, EAS environment variables, CI secrets
or repository files. With the password manager launching each command, run:

```bash
pnpm verify:app-review-account
pnpm dlx eas-cli@23.2.0 metadata:lint --profile app-review-metadata --json
```

The dynamic config deletes the eight names from the EAS process environment as
soon as it reads them, rejects local fixtures and incomplete contact details,
validates the candidate recording filename/device list, and never writes the
resulting review object. Keep using `production` for
binary submission. `app-review-metadata` is only for metadata lint/push.

Do not run `metadata:push` until the exact binary is processed, the public URLs
and review-account verifier are green, and the release owner explicitly
authorizes changing App Store Connect. At that point, use the same
password-manager injection for:

```bash
pnpm dlx eas-cli@23.2.0 metadata:push --profile app-review-metadata
```

Use a separate disposable account for the deletion test. Never ask Apple to
delete the shared review account and never run the deletion smoke test against
it.
