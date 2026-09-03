# App Review Guideline 2.1 response evidence

Duplicate this file for the exact candidate as
`review-response-guideline-2.1-<version>-<build>.md`. Complete it only from the
physical-device recording, smoke test and App Store Connect state for that
candidate. Do not include contact details, credentials, tokens, customer data
or private attachment URLs.

## Candidate identity

| Field | Result |
| --- | --- |
| Public version | `<VERSION>` |
| Apple build number | `<BUILD>` |
| Git commit | `<FULL_COMMIT_SHA>` |
| EAS build ID / URL | `<EAS_BUILD_URL>` |
| EAS submission ID / URL | `<EAS_SUBMISSION_URL>` |
| Runtime version | `<RUNTIME_VERSION>` |
| EAS build fingerprint | `<EAS_BUILD_FINGERPRINT>` |
| API origin | `https://api.zenguy.com` |

## 1 — Physical-device screen recording

| Field | Result |
| --- | --- |
| Attachment filename | `<SCREEN_RECORDING_FILENAME>` |
| Attachment SHA-256 | `<SCREEN_RECORDING_SHA256>` |
| Physical iPhone model | `<MODEL>` |
| iOS version | `<IOS_VERSION>` |
| Captured at | `<ISO_TIMESTAMP_WITH_ZONE>` |
| Duration | `<HH_MM_SS>` |

- [ ] Recording begins with a cold launch of the exact TestFlight candidate.
- [ ] Signed-out UI shows login, recovery and legal pages with no registration,
  workspace-creation, price, purchase or billing control.
- [ ] Existing-account login and the typical Overview, Tests/evidence, Uptime,
  Incidents and More flow are visible using only fictitious content.
- [ ] Optional push and App Lock prompts are shown or explicitly explained.
- [ ] A separate disposable account demonstrates the complete in-app account
  deletion flow; the shared App Review account is not deleted.
- [ ] Password entry, notifications, screenshots and background frames expose
  no credential, customer data, token or secret value.

## 2 — Devices and operating systems tested

`<TESTED_DEVICE_LIST>`

- [ ] Every listed device/OS was tested before submission.
- [ ] The recording device is present in this list and runs the latest OS
  available for that device at capture time.

## 3 — Functions, target audience and value

Zenguy is an operational companion for web, engineering and QA teams with an
existing organization-provided account. It presents browser-test evidence,
uptime, incidents and alerts so teams can diagnose customer-facing failures
from an iPhone. It is not a general-purpose browser.

## 4 — Access and setup instructions

Use the dedicated credentials stored only in App Store Connect Sign-In
Information. The account has one active fictitious workspace, no 2FA or expiry,
and supports concurrent sessions. Review Tests → Blog listing → latest run,
Uptime → Status API, and Incidents → Search filters. Completed evidence is
available immediately; a fresh remote run or push can depend on external time.

## 5 — External services, tools and platforms

- Cloudflare: API, database/object storage and public web properties.
- Zenguy-managed Chromium runner: authorized browser-test execution.
- Expo EAS/Updates and Apple APNs: binary delivery, signed updates and optional
  push notifications.
- OpenAI: optional browser-run fallback only after separate, versioned,
  revocable Owner/Admin consent; no secret value or account/member/billing/
  notification data is sent.
- Slack, Discord and Twilio: optional notification destinations.
- Stripe/Paddle: access status for the separately purchased web service only;
  iOS has no registration, price, purchase, subscription or payment flow.

## 6 — Regional differences

The same functions and controlled demo content are available in every selected
storefront. There are no region-exclusive features; only Apple's local rating
and legal presentation can differ.

## 7 — Regulation and content rights

Zenguy is not a regulated medical, financial, gambling or news service.
NIESAYO GROUP, S.L. owns the Zenguy brand and app artwork and licenses the
bundled fonts/components. Customer-configured website content is displayed only
inside that customer's private, access-controlled workspace under the
customer's authorization. App Review and App Store assets use controlled
fictitious content without customer or third-party trademarks.

## Final App Store Connect sign-off

- [ ] All seven sections above exactly match the Notes saved for this candidate.
- [ ] The hashed recording is attached to App Review Information and plays from
  start to finish after upload.
- [ ] Sign-In Information contains the verified review account and no value was
  copied into this evidence file.
- [ ] Device list, recording filename and demo labels in Notes match this file.
- [ ] The response addresses submission
  `cb0ae8b7-769b-485a-93a6-1e9846e6c298` without claiming that the rejected
  `0.2.0 (3)` or current `0.2.1 (4)` is the new candidate.

After sign-off, retain this completed copy and the recording in the approved
release-evidence directory. Their exact hashes belong in the candidate release
record; any later edit or transcoding requires a new verified snapshot.
