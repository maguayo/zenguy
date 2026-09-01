# App Review package — English (U.S.)

The `Notes to paste` block below is the canonical source read by
`apps/app/store.review.config.cjs`. Keep every `<...>` contact and credential
placeholder in this tracked file. The dynamic EAS Metadata profile obtains the
real values only from password-manager-injected process variables; for a manual
portal fallback, enter them directly from the vault into App Store Connect.
Never commit them to this repository.

## Contact fields

| Field | Value |
| --- | --- |
| First name | `<REVIEW_CONTACT_FIRST_NAME>` |
| Last name | `<REVIEW_CONTACT_LAST_NAME>` |
| Phone | `<REVIEW_CONTACT_PHONE_WITH_COUNTRY_CODE>` |
| Email | `<MONITORED_REVIEW_CONTACT_EMAIL>` |
| Sign-in required | Yes |
| Username | `<REVIEW_ACCOUNT_EMAIL>` |
| Password | `<REVIEW_ACCOUNT_PASSWORD>` |

The dynamic mapping is `APP_REVIEW_CONTACT_FIRST_NAME`,
`APP_REVIEW_CONTACT_LAST_NAME`, `APP_REVIEW_CONTACT_PHONE` and
`APP_REVIEW_CONTACT_EMAIL` for the contact fields, plus
`MAESTRO_REVIEW_EMAIL` and `MAESTRO_REVIEW_PASSWORD` for Sign-In Information.
`APP_REVIEW_SCREEN_RECORDING_FILENAME` and `APP_REVIEW_TESTED_DEVICES` inject
the candidate-specific Guideline 2.1 evidence into Notes. Do not assign those
values in an interactive shell or persist them in EAS.

The account must be verified, have no 2FA, remain active for the entire review,
support concurrent sessions and contain only fictitious data.

## Notes to paste

Guideline 2.1 information for this new app:

1. Physical-device recording: `<SCREEN_RECORDING_FILENAME>` is attached. It
starts with a cold launch, shows that there is no registration control, signs
in with an existing account, covers Overview, Tests and screenshot evidence,
Uptime, Incidents, More, optional permissions, sign-out, and the complete
in-app deletion flow using a separate disposable account.
2. Devices and operating systems tested before submission:
`<TESTED_DEVICE_LIST>`.
3. Functions and audience: Zenguy is an operational companion for web,
engineering and QA teams. It presents browser-test evidence, uptime, incidents
and alerts so teams can diagnose customer-facing failures from an iPhone.
4. Access: use the credentials in Sign-In Information. The account has one
active fictitious workspace and supports concurrent sessions. Open Tests →
Blog listing → latest run for steps/screenshots, Uptime → Status API for recent
checks, and Incidents → Search filters for a timeline. Do not delete the shared
review account; the recording uses a disposable account for deletion.
5. External services: Cloudflare hosts the API/storage/web properties; a
Zenguy-managed Chromium runner executes authorized tests; Expo EAS/Updates and
Apple APNs deliver builds, updates and optional push; Slack, Discord and Twilio
are optional alert destinations. OpenAI is an optional fallback only after an
Owner/Admin gives separate revocable consent. Stripe/Paddle govern the separate
web service only; iOS has no registration, purchase, price or payment flow.
6. Regions: the same functions and demo content are available in every selected
storefront. There are no region-exclusive features; only Apple's local rating
and legal presentation can differ.
7. Regulation and rights: Zenguy is not a regulated medical, financial,
gambling or news service. NIESAYO GROUP, S.L. owns the app brand/assets and
licenses its bundled fonts. Customer-configured website content is shown only
inside the customer's private workspace under that customer's authorization;
Review and store assets use controlled fictitious content.

Zenguy for iOS is a free companion for people whose organization already
supplied a Zenguy account, workspace and active access. Under Guideline
3.1.3(f), it does not create accounts or workspaces, sell or activate
subscriptions, show prices, manage payments or direct users to buy elsewhere.
Push, App Lock and Universal Links are optional. The OpenAI control starts off
and the backend blocks remote disclosure without current consent.

Support: https://zenguy.com/support/
Privacy: https://zenguy.com/privacy/
Privacy choices and deletion: https://zenguy.com/privacy-choices/

## Before pasting

- Confirm every named demo item still exists and opens in the exact TestFlight
  build selected for review.
- Inject the review credentials through the approved password manager and run
  `pnpm verify:app-review-account` from `apps/app`; do not paste the values into
  the shell command.
- With all eight variables injected by the password manager, run
  `pnpm dlx eas-cli@23.2.0 metadata:lint --profile app-review-metadata --json`.
  Use `metadata:push` only after the candidate and public gates are green and
  the release owner explicitly authorizes the App Store Connect write.
- Replace any changed sample labels above; never make Apple hunt for a screen.
- Confirm the contact phone and email are monitored during Apple's working day.
- Store credentials only in App Store Connect and the approved password vault.
- Attach the exact physical-device recording required by Apple for Guideline
  2.1 and retain its SHA-256 in the candidate release record.
