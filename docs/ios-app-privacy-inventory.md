# iOS App Privacy inventory

Canonical inventory for Zenguy iOS, App Store Connect App Privacy,
`PrivacyInfo.xcprivacy`, the public Privacy Policy, and App Review. Last
reconciled: **1 September 2026**.

The structured companion source is `apps/app/app-privacy.config.json`. Its
eleven rows drive the collected-data entries in Expo's application privacy
manifest and are checked against the table below by
`apps/app/scripts/app-privacy-contract.mjs`. Apple's App Store Connect OpenAPI
specification published on 15 July 2026 exposes the privacy-policy and privacy-
choices URLs but no resource for the data-use questionnaire. The JSON file is
therefore an internal, non-secret checklist for exact portal entry, not an API
or upload payload.

The iOS app is an authenticated companion for existing accounts. It contains
no advertising SDK, no Google Analytics SDK, no cross-company tracking, no
registration or purchase flow, and no payment-card collection. “Collected” is
used in Apple’s sense: data transmitted off the device and retained beyond the
real-time request. All declared data is linked to the signed-in account and is
not used for tracking.

## Operational inventory

| Data | iOS source and examples | Purpose | Linked | Zenguy retention | Recipients |
| --- | --- | --- | --- | --- | --- |
| Name and email | Existing-account profile, login email, member/invitation and email-channel addresses | Authentication, identity, access control, collaboration and alerts | Yes | While the account/workspace is active; removed or anonymized on account/workspace deletion, except limited legal/security records | Cloudflare; email delivery provider where needed |
| Phone number | SMS, WhatsApp or call notification destination explicitly entered by an authorized workspace member | Operational alerts | Yes | While the channel/workspace is active; deleted with the channel/workspace | Cloudflare and Twilio |
| User and workspace identifiers | Internal user, workspace, membership, resource and audit identifiers | Authorization, tenant isolation, support, security and reliable sync | Yes | While active; user attribution is removed on account deletion and owned workspace data is purged | Cloudflare |
| Push device identifier | Expo push token, internal push-device ID, device model, iOS platform and app version | Optional push delivery and token maintenance | Yes | While enabled/active; inactive provider tokens are purged after 90 days; deleted on sign-out/account deletion | Cloudflare, Expo and Apple Push Notification service |
| Service configuration and free-form content | Workspace settings, test names/instructions/URLs, monitor configuration, incident updates, webhook destinations and encrypted test secrets | Core browser testing, uptime monitoring, incidents and notification functionality | Yes | While the resource is active; execution evidence and expired run data are purged after 30 days; workspace deletion purges operational data | Cloudflare; configured Slack/Discord endpoints; OpenAI only as described below, after workspace consent |
| Browser-run evidence | Server-generated screenshots, page state, sanitized URLs, steps, console/network results and failure reports | Show and diagnose test results | Yes | 30 days | Cloudflare; OpenAI during a consented run |
| Subscription history/status | Existing workspace access and subscription state returned by the service; no prices, payment controls or card data in iOS | Decide whether the pre-existing account may use the companion app | Yes | Financial/tax records follow the legal schedule, generally up to six years after deletion; active status while the workspace exists | Cloudflare and Stripe/Paddle for the web-bought service; no iOS purchase provider |
| Product interaction | App opens and allow-listed screen/resource visit types, timestamp, app version, source and relevant opaque resource ID | First-party operation, support, security, reliability and aggregate feature-usage measurement | Yes | High-volume visits for 90 days; normal activity events for 365 days | Cloudflare only |
| Other usage/diagnostic data | Request IP in security/audit records, API status/error context, app version, runner/notification delivery diagnostics | Rate limiting, fraud/abuse prevention, debugging and service reliability | Yes | Short-lived rate-limit data; operational diagnostics 30 days where part of run evidence; necessary security records while active and, after deletion, only as stated in the policy | Cloudflare; provider-specific delivery diagnostics where applicable |
| Remote-AI consent record | Provider, policy version, accepted/revoked timestamps and Owner/Admin actor | Prove and enforce the optional disclosure choice | Yes | While the workspace is active and as needed to demonstrate the choice; actor ID is removed on account deletion and the row is deleted with the workspace | Cloudflare |
| Optional OpenAI run data | Test name/instructions, target URLs/device configuration, relevant page content/screenshots, console/network results and model input/output | Execute and assess browser-test steps on the Cloudflare Containers runner, only while the workspace has current explicit consent | Yes | Zenguy evidence: 30 days. OpenAI standard abuse-monitoring logs: up to 30 days unless an approved shorter control applies | OpenAI, only after explicit workspace consent |

Account erasure is enforced against an executable schema inventory. It covers
all 31 direct account references plus indirect identifiers in audit/activity
JSON, run authorization snapshots, quota counters and rate-limit keys. Sessions
are revoked, personal credentials and destinations are removed or disabled,
joined memberships are removed, and owned workspaces enter the durable
cancellation and purge saga. Only pseudonymous tombstones and the minimum
anonymized fiscal, antifraud or security evidence remain.

Configured secret **values** never leave Zenguy for an OpenAI run.
The remotely released snapshot contains placeholder names only. Account,
member, billing and notification data are also excluded from the OpenAI path.
The backend checks a current versioned consent before claiming or disclosing a
remote job; the UI control is not the security boundary.

Face ID/Touch ID templates and match results stay within Apple’s local
authentication framework. The app receives only success/failure and does not
collect biometric data.

## App Store Connect answers

Use these answers for the iOS App Privacy label. Every row is **Linked to the
User: Yes**, **Used for Tracking: No**. Zenguy does not combine these data with
third-party advertising data or share them with data brokers.

| App Privacy category | Data type | Purpose(s) |
| --- | --- | --- |
| Contact Info | Name | App Functionality |
| Contact Info | Email Address | App Functionality |
| Contact Info | Phone Number | App Functionality |
| User Content | Photos or Videos | App Functionality |
| User Content | Other User Content | App Functionality |
| Identifiers | User ID | App Functionality; Analytics |
| Identifiers | Device ID | App Functionality |
| Purchases | Purchase History | App Functionality |
| Usage Data | Product Interaction | App Functionality; Analytics |
| Usage Data | Other Usage Data | App Functionality; Analytics |
| Diagnostics | Other Diagnostic Data | App Functionality |

Portal publication remains a human-controlled legal declaration. In App Store
Connect, select that the app collects data, enter exactly these eleven rows,
answer **Linked to the User: Yes** and **Used for Tracking: No** for each, and
select only the listed purposes. Compare the Product Page Preview with this
table before clicking Publish. The required role is Account Holder, Admin or
App Manager; the person publishing must confirm that the answers remain true
for every platform attached to the app record.

Immediately before portal entry, run `pnpm --dir apps/app verify:app-privacy`.
A green result proves source alignment only; it does not publish the legal
declaration or prove that the current portal values match until they are
visually reconciled in App Store Connect.

Do **not** select these unless the implementation changes:

- Payment Info or Other Financial Info: payment details are entered outside
  iOS and are never available to the iOS client or Zenguy.
- Precise/Coarse Location: the iOS app requests no location permission and the
  iOS request path does not retain a derived location. IP addresses are used as
  security/diagnostic data, not to build a location history.
- Contacts, Health, Fitness, Sensitive Info, Audio, Search History,
  Advertising Data, Crash Data or Performance Data: the app does not collect
  them. Face ID/Touch ID remains on-device.
- Browsing History: customer-configured test URLs and automated browser state
  are service configuration/evidence, not a history of sites the person viewed
  in the iOS app.
- Emails or Text Messages: Zenguy sends operational alerts but does not provide
  person-to-person messaging in the iOS app. Entered destination addresses are
  declared under Contact Info.

App Store Connect URLs:

- Privacy Policy: `https://zenguy.com/privacy/`
- User Privacy Choices: `https://zenguy.com/privacy-choices/`
- Support: `https://zenguy.com/support/`

## Privacy manifest mapping

`apps/app/app.config.ts` declares the same eleven data types under
`ios.privacyManifests.NSPrivacyCollectedDataTypes`, with tracking disabled and
the purposes above. Expo generates the application `PrivacyInfo.xcprivacy`.

The application manifest also declares the complete reviewed union of
required-reason APIs used by Expo and React Native:

| Required-reason API | Reasons packaged in the app manifest |
| --- | --- |
| File timestamp | `0A2A.1`, `3B52.1`, `C617.1` |
| Disk space | `85F4.1`, `E174.1` |
| System boot time | `35F9.1` |
| User defaults | `CA92.1` |

This duplication is deliberate. Third-party modules ship their own privacy
manifests, but Apple tooling does not reliably aggregate every manifest from a
static CocoaPod; Expo therefore recommends copying required reasons from SDK
manifests into the app manifest when needed. `pnpm verify:release-config`
protects the source declaration, while `pnpm verify:ios-archive` inspects the
actual packaged app and the aggregate of its SDK manifests.

Before submitting each binary:

1. Generate the production native project/archive with the pinned Xcode image.
2. Run `pnpm verify:ios-archive -- /path/to/Zenguy.xcarchive --minimum-build N`
   without `--allow-unsigned` against the exact signed candidate.
3. Export Xcode’s Privacy Report for that same archive.
4. Compare every collected-data row and required-reason API with this file and
   `app.config.ts`.
5. Compare the resulting report with the published App Store Connect answers.
6. Resolve every unexpected SDK/data/API entry; do not suppress a warning by
   adding a reason that the app does not actually satisfy.

Authoritative references:

- [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Apple collected-data manifest values](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)
- [Apple required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [Expo: Privacy manifests](https://docs.expo.dev/guides/apple-privacy/)
- [OpenAI business-data commitments](https://openai.com/business-data/)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
