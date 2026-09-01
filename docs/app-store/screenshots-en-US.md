# App Store screenshots — English (U.S.)

Use one consistent accepted 6.9-inch portrait size for the complete set. The
preferred simulator/device output is **1320 × 2868 px**; Apple also currently
accepts 1260 × 2736 and 1290 × 2796. Upload PNG or JPEG with no alpha. One to
ten images are allowed. Because `supportsTablet` is false, no iPad set is
required.

## Production set

Create five clean screenshots from the exact release UI with a stable status
bar, no debug banners, no notification previews and fictitious content:

1. **Know what is working** — Overview with current health and usage.
2. **See every browser-test step** — completed Test Run with safe screenshot
   evidence.
3. **Track uptime at a glance** — monitor detail with availability and response
   time.
4. **Understand incidents quickly** — incident detail and timeline.
5. **Alerts where your team needs them** — notification channels or optional
   push controls, with non-personal destinations.

Optional sixth image: Tests list with recent pass/fail state. Do not use login,
empty states, Account, AI consent or deletion as a lead screenshot.

## Data rules

- Use a dedicated screenshot workspace, not a customer or employee workspace.
- Use fictional people, destinations and domains controlled for this purpose.
- Never show email addresses, phone numbers, webhook URLs, tokens, secret names
  that reveal a real integration, customer domains or payment/subscription
  state.
- Do not show registration, prices, buying, activation or payment-management
  instructions in imagery or captions.
- Avoid a browser screenshot whose captured page contains third-party marks or
  content unless rights are documented.

## Capture and QA

The repeatable flow is `apps/app/maestro/app-store-screenshots.yaml`, followed
by `pnpm prepare:app-store-screenshots`. Run it against the exact TestFlight
candidate on a compatible physical iPhone, or a Release simulator build from
the same commit and production configuration after visually reconciling it with
that candidate. Account must report the expected native version and remote EAS
build number.

Inject `MAESTRO_REVIEW_EMAIL` and `MAESTRO_REVIEW_PASSWORD` through the approved
password manager's process environment. Never pass either literal on the
command line, export it into shell history, store it in a flow file or retain it
in the Maestro output. From `apps/app`:

```bash
pnpm verify:app-review-account

maestro test maestro/app-store-screenshots.yaml \
  --test-output-dir=/private/tmp/zenguy-app-store-raw

pnpm prepare:app-store-screenshots -- \
  /private/tmp/zenguy-app-store-raw \
  /private/tmp/zenguy-app-store-final \
  --version 0.2.2 \
  --build <native-build-number> \
  --commit <40-character-candidate-commit> \
  --eas-build <eas-build-uuid> \
  --eas-submission <eas-submission-uuid>
```

The preparer rejects missing or duplicate captures, the wrong dimensions,
non-RGB output, alpha, implausible file sizes and malformed provenance. It
creates five JPEGs plus `app-store-screenshots.json`, which records source names,
version/build, candidate commit, EAS build/submission IDs, file sizes and SHA-256
checksums. Always use a new empty output directory. This validates packaging and
traceability only; the final visual/content review and upload remain manual.

- [ ] Install/capture the final production-profile build, not Expo Go.
- [ ] Set the simulator/device to a supported 6.9-inch resolution and portrait.
- [ ] Use a deterministic time/battery/network presentation across the set.
- [ ] Inspect every image at 100% for PII, secrets, clipping and stale copy.
- [ ] Verify exact pixel dimensions, RGB color and absence of alpha.
- [ ] Compare each image with the build selected in App Store Connect.
- [ ] Retain the generated manifest with the approved exported files and put
  its exact SHA-256 in the candidate's release-record copy.

After the visual sign-off, run `pnpm verify:app-store-release-record` with the
manifest and its five adjacent JPEGs. The verifier re-hashes every image and
rejects any candidate identity, dimension or byte-level mismatch; do not edit,
recompress or rename a file after that verification.

Current Apple specification:
[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
