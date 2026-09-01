# App Store release smoke-test record

Duplicate this file for the exact candidate as
`release-smoke-test-<version>-<build>.md`; do not mark a row from a simulator,
another build or an OTA with a different fingerprint. Record the canonical EAS
build and submission URLs (which embed their full UUIDs), and fill TestFlight status exactly as
`VALID / IN_BETA_TESTING`; a processing or expired build is not a candidate.

## Candidate identity

| Field | Result |
| --- | --- |
| Public version | `<VERSION>` |
| Apple build number | `<BUILD>` |
| Git commit | `<FULL_COMMIT_SHA>` |
| EAS build ID / URL | `<EAS_BUILD_URL>` |
| EAS submission ID / URL | `<EAS_SUBMISSION_URL>` |
| Runtime fingerprint | `<FINGERPRINT>` |
| API origin | `https://api.zenguy.com` |
| TestFlight status | `<VALID_AND_IN_BETA_TESTING>` |
| Tester | `<NAME>` |
| Physical iPhone model | `<MODEL>` |
| iOS version | `<IOS_VERSION>` |
| Test date/time zone | `<ISO_TIMESTAMP_WITH_ZONE>` |

## Preconditions

- [ ] Installed the exact build from TestFlight on a physical iPhone.
- [ ] Deleted the previous app first for the clean-install pass.
- [ ] Review account is verified, has active access, no 2FA and fictitious data.
- [ ] A separate disposable account exists for the deletion test.
- [ ] Backend, local runner, APNs and the controlled test target are healthy.
- [ ] No production customer data or real secret value is visible.

## Existing-account-only acquisition audit

- [ ] Clean launch offers only sign-in, forgot password, Terms and Privacy.
- [ ] There is no sign-up, create-account or create-workspace control.
- [ ] Registration/acquisition deep links cannot open a hidden mobile screen.
- [ ] There is no price, purchase, subscription activation, checkout, billing
  management or link/instruction to acquire access elsewhere.
- [ ] An existing account without access reaches the neutral access-unavailable
  screen and can sign out or contact its organization.
- [ ] A valid existing account reaches its workspace.

## Core flow

- [ ] Sign in and load Overview.
- [ ] Open Tests, a test, a completed run, its steps and screenshot evidence.
- [ ] Start one safe test against the controlled target and see it finish.
- [ ] Open Uptime, a monitor and response-time history.
- [ ] Open Incidents and an incident timeline.
- [ ] Open More, notifications, secrets, members, workspace settings and
  AI data sharing according to the review account role.
- [ ] Refresh the session after more than one access-token lifetime or force a
  token refresh without losing navigation.
- [ ] Sign out, confirm workspace data disappears, and sign in again.

## Lifecycle, device and links

- [ ] Background/foreground does not expose workspace data in the app switcher.
- [ ] App Lock works with Face ID/Touch ID/device passcode and its delay setting.
- [ ] Denying App Lock leaves the account usable and recoverable.
- [ ] Push soft prompt precedes the iOS prompt; allow and receive one incident
  notification on the physical device.
- [ ] Tapping push opens only an approved `https://app.zenguy.com/w/...` route.
- [ ] Verified Universal Links open reset, invitation and approved workspace
  routes; malformed or acquisition links fail closed.
- [ ] Cold start applies only a signed EAS Update with the matching runtime.

## Network and failure handling

- [ ] Slow network shows bounded loading states and no duplicate mutation.
- [ ] Offline launch/sign-in/action errors are understandable and recover after
  connectivity returns.
- [ ] Expired/revoked refresh token signs out and clears local credentials.
- [ ] API errors do not expose tokens, secrets, stack traces or internal URLs.

## Privacy and deletion

- [ ] AI sharing starts off, requires an unpremarked affirmative action, records
  the policy version and can be revoked; remote execution is blocked without it.
- [ ] A secret-backed test confirms remote AI receives placeholder names only,
  never secret values.
- [ ] On the disposable account, Account → Delete my account requires current
  password, exact DELETE and final confirmation.
- [ ] Deleted-account sessions on two devices stop working; push and membership
  records are gone and owned workspaces follow the documented deletion policy.
- [ ] Terms, Privacy, Support and Privacy Choices links resolve over HTTPS.

## Store presentation

- [ ] App name/icon/launch screen/version match the selected store record.
- [ ] Account reports the same native version and build as EAS and App Store
  Connect.
- [ ] Every screenshot matches the production UI and contains fictitious data.
- [ ] Review Notes steps and named demo items are accurate.
- [ ] No screenshot, copy or binary string advertises registration or purchase.

## Result

- [ ] PASS — candidate may be associated with the App Store version.
- [ ] FAIL — do not submit.

Failures, evidence and follow-up:

`<NOTES_AND_LINKS>`

After PASS, retain this completed copy without credentials, hash its exact
bytes into the candidate release record, and run
`pnpm verify:app-store-release-record`. Any later edit invalidates that hash and
requires a new verified release-record snapshot.
