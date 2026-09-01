# App Store metadata — English (U.S.)

Copy source for App Store Connect. Reconcile every field against the live
record before saving. Character counts below follow Apple's current limits.
The non-secret fields that EAS Metadata can represent are mirrored in
`apps/app/store.config.json`; `pnpm dlx eas-cli@23.2.0 metadata:lint --profile
production --json` must return `[]` before upload. Do not put review contacts,
credentials, App Privacy answers or the current age-rating questionnaire in
that file. The separate `apps/app/store.review.config.cjs` overlay adds contact,
sign-in information and the notes from `review-notes-en-US.md` only in memory
when the `app-review-metadata` profile is launched through password-manager
environment injection, including candidate-specific recording and physical-
device evidence. The exact portal-only age answers are versioned in
`apps/app/app-age-rating.config.json` and checked against this document by
`pnpm verify:app-age-rating`.

## App information

| Field | Value |
| --- | --- |
| Name (6/30) | `Zenguy` |
| Subtitle (29/30) | `Website monitoring & evidence` |
| Primary category | Developer Tools |
| Secondary category | Business |
| Content rights | Zenguy owns or has licensed all content included in the app. Customer-provided website content is displayed only inside that customer's private workspace. |
| Copyright | `2026 NIESAYO GROUP, S.L.` |
| Privacy Policy URL | `https://zenguy.com/privacy/` |
| User Privacy Choices URL | `https://zenguy.com/privacy-choices/` |

## Version 0.2.2

### Promotional text (150/170)

Review browser-test evidence, uptime and incidents from your iPhone. Zenguy
for iOS is a free companion app for teams with an existing Zenguy account.

### Description

Zenguy for iOS is the operational companion for teams that already use
Zenguy. Sign in with an existing account to see whether the journeys and
services your organization monitors are working as expected.

From your iPhone you can:

• Review browser tests and their recent results.
• Inspect screenshots and step-by-step evidence from completed runs.
• Check uptime monitors, response times and current health.
• Investigate incidents and their timelines.
• Receive optional push alerts when something fails or recovers.
• View notification channels, secrets, members and workspace settings
according to your existing role.
• Protect the app with Face ID, Touch ID or the device passcode.
• Delete your Zenguy account directly from Account settings.

Browser tests run remotely against systems that the organization is authorized
to test. The iOS app shows their configuration and results; it is not a
general-purpose web browser.

Zenguy for iOS requires a pre-existing Zenguy account, workspace and active
access supplied by your organization. The iOS app does not offer account or
workspace registration, purchases, subscriptions, prices or payment
management.

### Keywords (97/100 bytes in ASCII)

`website monitoring,synthetic monitoring,uptime,incidents,alerts,browser tests,evidence,operations`

### URLs

| Field | Value |
| --- | --- |
| Support URL | `https://zenguy.com/support/` |
| Marketing URL | `https://zenguy.com/` |

## Distribution settings

- Price: Free.
- Release: Manually release this version.
- Platforms: iPhone only (`supportsTablet: false`).
- Availability: select only the storefronts supported by the company's legal,
  tax and DSA configuration; record the exact sorted set of three-letter App
  Store Connect territory IDs in the release record before Review.
- Export compliance: the binary declares `ITSAppUsesNonExemptEncryption=false`
  because it uses only standard operating-system TLS.

## Age rating declaration

Answer from the production app, not from the marketing site:

| Section | Question | Answer |
| --- | --- | --- |
| In-App Controls | Parental Controls | No |
| In-App Controls | Age Assurance | No |
| Capabilities | Unrestricted Web Access | No |
| Capabilities | User-Generated Content | No |
| Capabilities | Social Media | No |
| Capabilities | Social Media Disabled for Users Under 13 | No |
| Capabilities | Messaging and Chat | No |
| Capabilities | Advertising | No |
| Mature Themes | Profanity or Crude Humor | None |
| Mature Themes | Horror/Fear Themes | None |
| Mature Themes | Alcohol, Tobacco, or Drug Use or References | None |
| Medical or Wellness | Medical or Treatment Information | None |
| Medical or Wellness | Health or Wellness Topics | None |
| Sexuality or Nudity | Mature or Suggestive Themes | None |
| Sexuality or Nudity | Sexual Content or Nudity | None |
| Sexuality or Nudity | Graphic Sexual Content and Nudity | None |
| Violence | Cartoon or Fantasy Violence | None |
| Violence | Realistic Violence | None |
| Violence | Prolonged Graphic or Sadistic Realistic Violence | None |
| Violence | Guns or Other Weapons | None |
| Chance-Based Activities | Gambling | No |
| Chance-Based Activities | Simulated Gambling | None |
| Chance-Based Activities | Contests | None |
| Chance-Based Activities | Loot Boxes | No |
| Additional Information | Calculated Global Rating | 4+ |
| Age Categories and Override | Made for Kids | Not Applicable |
| Age Categories and Override | Override to Higher Age Rating | 18+ |
| Additional Information | Expected Display Rating | 18+ |

Apple defines User-Generated Content here as content broadly distributed as
part of the intended experience. Zenguy keeps customer-authored configuration
and captured evidence inside private, access-controlled workspaces rather than
broadly distributing it, so that capability is **No**. It also has no embedded
general-purpose browser or address bar: authorized browser tests run remotely,
and the app displays their stored configuration and evidence.

The content answers calculate to 4+, but set **Override to Higher Age Rating as
18+** because the Zenguy Terms of Service require every user to be 18 or older.
Apple requires an override when a EULA's minimum age is higher than the
calculated rating. **Made for Kids remains Not Applicable.**

Customer-configured tests can capture content from systems the customer is
authorized to test. Use a controlled, non-sensitive demo site and fictitious
evidence in the review account and screenshots. If the live questionnaire uses
materially different wording, pause and reassess rather than forcing these
answers into a different question.

## Source checks

- Machine-readable subset: `apps/app/store.config.json` (EAS Metadata beta;
  push only after the exact binary and public URLs are ready).
- Structured age-rating source: `apps/app/app-age-rating.config.json`; enter its
  24 answers and 18+ override exactly in App Store Connect.
- Ephemeral review overlay: `apps/app/store.review.config.cjs`; use only with
  `metadata:lint`/`metadata:push --profile app-review-metadata`, never for a
  binary submission and never with values exported into an interactive shell.
- Candidate asset/license evidence: `docs/app-store/content-rights.md`.
- Apple: [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- Apple: [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)
- Apple: [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
