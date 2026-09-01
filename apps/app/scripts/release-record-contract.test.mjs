import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseRecord } from "./release-record-contract.mjs";

const buildId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const buildUrl = `https://expo.dev/accounts/maguayo/projects/zenguy/builds/${buildId}`;
const submissionUrl = `https://expo.dev/accounts/maguayo/projects/zenguy/submissions/${submissionId}`;
const commit = "a".repeat(40);
const fingerprint = "b".repeat(40);
const screenshotsHash = "c".repeat(64);
const smokeHash = "d".repeat(64);
const privacyHash = "e".repeat(64);
const appReviewResponseHash = "f".repeat(64);
const screenRecordingHash = "9".repeat(64);
const screenRecordingFilename = "zenguy-0.2.2-5-review.mp4";

function validRecord() {
  return {
    schemaVersion: 4,
    app: {
      name: "Zenguy",
      bundleIdentifier: "com.zenguy.app",
      appleTeamId: "HT84Q65URB",
      ascAppId: "6804201911",
      easProjectId: "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7",
    },
    ageRating: {
      sourceReconciledOn: "2026-09-01",
      calculatedGlobalRating: "4+",
      madeForKids: "NOT_APPLICABLE",
      overrideToHigherAgeRating: "18+",
      displayGlobalRating: "18+",
    },
    candidate: {
      version: "0.2.2",
      build: "5",
      commit,
      runtimeFingerprint: fingerprint,
      apiOrigin: "https://api.zenguy.com",
      channel: "production",
      easBuildId: buildId,
      easBuildUrl: buildUrl,
      easSubmissionId: submissionId,
      easSubmissionUrl: submissionUrl,
      easBuildStatus: "FINISHED",
      easSubmissionStatus: "FINISHED",
      appleBuildState: "VALID",
      testFlightState: "IN_BETA_TESTING",
    },
    distribution: {
      testFlightGroup: "Zenguy Internal",
      automaticTestFlightDistribution: true,
      releaseMethod: "MANUAL",
      phasedRelease: false,
      storefronts: ["ESP", "USA"],
    },
    evidence: {
      appReviewResponseSha256: appReviewResponseHash,
      privacyReportSha256: privacyHash,
      screenshotsManifestSha256: screenshotsHash,
      screenRecordingFilename,
      screenRecordingSha256: screenRecordingHash,
      smokeTestRecordSha256: smokeHash,
    },
    signoffs: {
      ageRatingSaved: true,
      publicUrlsVerified: true,
      reviewAccountVerified: true,
      physicalDeviceSmokeTestPassed: true,
      signedArchiveVerified: true,
      privacyReportReconciled: true,
      screenshotsReviewedAt100Percent: true,
      contentRightsConfirmed: true,
      guideline21ResponseSaved: true,
      physicalDeviceScreenRecordingAttached: true,
      appPrivacyPublished: true,
      metadataSaved: true,
      agreementsAndTraderStatusVerified: true,
    },
    credentials: {
      reviewedAt: "2026-09-02T09:00:00+02:00",
      responsible: "Release owner",
      distributionCertificateSerial: "6A5F4472F596BA3F5C6E50D700221A8",
      distributionCertificateExpiresOn: "2027-07-25",
      provisioningProfileId: "YNK325M2FS",
      provisioningProfileExpiresOn: "2027-07-25",
      apnsKeyId: "8UDV42545G",
      ascApiKeyId: "U3MR73JGPS",
    },
    appReview: {
      stage: "REVIEW_READY",
      status: "READY_FOR_REVIEW",
      submittedAt: null,
      approvedAt: null,
      releasedAt: null,
      appStoreUrl: null,
    },
    recordedAt: "2026-09-02T10:00:00+02:00",
  };
}

function screenshotManifest() {
  return {
    app: "Zenguy",
    build: "5",
    commit,
    easBuildId: buildId,
    easSubmissionId: submissionId,
    files: [
      ["01-overview.jpg", "01-overview.png", "Know what is working"],
      [
        "02-test-run-evidence.jpg",
        "02-test-run-evidence.png",
        "See every browser-test step",
      ],
      ["03-uptime.jpg", "03-uptime.png", "Track uptime at a glance"],
      ["04-incident.jpg", "04-incident.png", "Understand incidents quickly"],
      [
        "05-notifications.jpg",
        "05-notifications.png",
        "Alerts where your team needs them",
      ],
    ].map(([filename, source, caption], index) => ({
      caption,
      filename,
      format: "JPEG",
      hasAlpha: false,
      height: 2868,
      sha256: String(index + 1).repeat(64),
      sizeBytes: 100_000 + index,
      source,
      width: 1320,
    })),
    generatedAt: "2026-09-02T07:30:00.000Z",
    locale: "en-US",
    schemaVersion: 1,
    version: "0.2.2",
  };
}

function smokeRecord() {
  const checked = Array.from(
    { length: 41 },
    (_, index) => `- [x] Completed physical-device check ${index + 1}.`,
  ).join("\n");
  return `# App Store release smoke-test record

| Field | Result |
| --- | --- |
| Public version | \`0.2.2\` |
| Apple build number | \`5\` |
| Git commit | \`${commit}\` |
| EAS build ID / URL | \`${buildUrl}\` |
| EAS submission ID / URL | \`${submissionUrl}\` |
| Runtime fingerprint | \`${fingerprint}\` |
| API origin | \`https://api.zenguy.com\` |
| TestFlight status | \`VALID / IN_BETA_TESTING\` |
| Tester | \`Release owner\` |
| Physical iPhone model | \`iPhone 17 Pro\` |
| iOS version | \`26.5\` |
| Test date/time zone | \`2026-09-02T09:45:00+02:00\` |

${checked}
- [x] PASS — candidate may be associated with the App Store version.
- [ ] FAIL — do not submit.

Failures, evidence and follow-up:

\`None; all checks passed.\`
`;
}

function guideline21Response() {
  const checked = Array.from(
    { length: 13 },
    (_, index) => `- [x] Completed Guideline 2.1 evidence check ${index + 1}.`,
  ).join("\n");
  return `# App Review Guideline 2.1 response evidence

| Field | Result |
| --- | --- |
| Public version | \`0.2.2\` |
| Apple build number | \`5\` |
| Git commit | \`${commit}\` |
| EAS build ID / URL | \`${buildUrl}\` |
| EAS submission ID / URL | \`${submissionUrl}\` |
| Runtime fingerprint | \`${fingerprint}\` |
| API origin | \`https://api.zenguy.com\` |

## 1 — Physical-device screen recording

| Field | Result |
| --- | --- |
| Attachment filename | \`${screenRecordingFilename}\` |
| Attachment SHA-256 | \`${screenRecordingHash}\` |
| Physical iPhone model | \`iPhone 17 Pro\` |
| iOS version | \`26.5\` |
| Captured at | \`2026-09-02T09:40:00+02:00\` |
| Duration | \`00:04:30\` |

## 2 — Devices and operating systems tested

\`iPhone 17 Pro — iOS 26.5\`

## 3 — Functions, target audience and value
## 4 — Access and setup instructions
## 5 — External services, tools and platforms
## 6 — Regional differences
## 7 — Regulation and content rights

${checked}
`;
}

function evidence() {
  return {
    ageRatingConfig: {
      configVersion: 1,
      lastReconciled: "2026-09-01",
      apple: {
        answers: Array.from({ length: 24 }, (_, index) => ({ index })),
        calculatedGlobalRating: "4+",
        madeForKids: "NOT_APPLICABLE",
        overrideToHigherAgeRating: "18+",
        displayGlobalRating: "18+",
      },
    },
    appReviewResponseSha256: appReviewResponseHash,
    appReviewResponseSource: guideline21Response(),
    packageVersion: "0.2.2",
    privacyReportSha256: privacyHash,
    screenshotsManifest: screenshotManifest(),
    screenshotsManifestSha256: screenshotsHash,
    screenRecordingFilename,
    screenRecordingSha256: screenRecordingHash,
    smokeTestRecordSha256: smokeHash,
    smokeTestSource: smokeRecord(),
  };
}

test("accepts one fully reconciled review-ready candidate", () => {
  assert.deepEqual(validateReleaseRecord(validRecord(), evidence()), []);
});

test("accepts chronological approved and released lifecycle evidence", () => {
  const record = validRecord();
  record.appReview = {
    stage: "RELEASED",
    status: "READY_FOR_DISTRIBUTION",
    submittedAt: "2026-09-02T11:00:00+02:00",
    approvedAt: "2026-09-03T11:00:00+02:00",
    releasedAt: "2026-09-03T12:00:00+02:00",
    appStoreUrl: "https://apps.apple.com/app/id6804201911",
  };
  record.recordedAt = "2026-09-03T12:30:00+02:00";

  assert.deepEqual(validateReleaseRecord(record, evidence()), []);
});

test("rejects age-rating evidence or sign-off drift", () => {
  const record = validRecord();
  record.ageRating.overrideToHigherAgeRating = "4+";
  record.signoffs.ageRatingSaved = false;

  const failures = validateReleaseRecord(record, evidence());
  assert.equal(
    failures.includes("release record age-rating evidence is not exact"),
    true,
  );
  assert.equal(
    failures.includes(
      "release record age-rating evidence does not match the candidate source",
    ),
    true,
  );
  assert.equal(
    failures.includes("all review-ready sign-offs must be explicitly true"),
    true,
  );
});

test("rejects a stale build and screenshot manifest from another candidate", () => {
  const record = validRecord();
  record.candidate.build = "4";

  const failures = validateReleaseRecord(record, evidence());
  assert.equal(
    failures.includes("candidate identity/status is incomplete, stale or not reviewable"),
    true,
  );
  assert.equal(
    failures.includes("screenshot manifest does not identify the exact candidate"),
    true,
  );
});

test("rejects dashboard URLs that do not identify the recorded EAS objects", () => {
  const record = validRecord();
  record.candidate.easBuildUrl =
    "https://expo.dev/accounts/another-owner/projects/zenguy/builds/11111111-1111-4111-8111-111111111111";

  const failures = validateReleaseRecord(record, evidence());
  assert.equal(
    failures.includes("candidate identity/status is incomplete, stale or not reviewable"),
    true,
  );
});

test("rejects missing sign-off, device provenance and inconsistent lifecycle", () => {
  const record = validRecord();
  record.signoffs.appPrivacyPublished = false;
  record.appReview = {
    stage: "SUBMITTED",
    status: "READY_FOR_REVIEW",
    submittedAt: null,
    approvedAt: null,
    releasedAt: null,
    appStoreUrl: null,
  };
  const incompleteEvidence = evidence();
  incompleteEvidence.smokeTestSource = incompleteEvidence.smokeTestSource.replace(
    "| Physical iPhone model | `iPhone 17 Pro` |\n",
    "",
  );

  const failures = validateReleaseRecord(record, incompleteEvidence);
  assert.equal(
    failures.includes("all review-ready sign-offs must be explicitly true"),
    true,
  );
  assert.equal(
    failures.includes("SUBMITTED lifecycle is incomplete or inconsistent"),
    true,
  );
  assert.equal(
    failures.includes("smoke-test physical-device provenance is incomplete"),
    true,
  );
});

test("rejects unsafe build numbers and impossible credential dates", () => {
  const record = validRecord();
  record.candidate.build = "9".repeat(400);
  record.credentials.distributionCertificateExpiresOn = "2027-02-31";

  const failures = validateReleaseRecord(record, evidence());
  assert.equal(
    failures.includes("candidate identity/status is incomplete, stale or not reviewable"),
    true,
  );
  assert.equal(
    failures.includes("credential review metadata is incomplete or malformed"),
    true,
  );
});

test("rejects mismatched or incomplete Guideline 2.1 recording evidence", () => {
  const record = validRecord();
  record.evidence.screenRecordingSha256 = "8".repeat(64);
  const incompleteEvidence = evidence();
  incompleteEvidence.appReviewResponseSource = incompleteEvidence.appReviewResponseSource
    .replace("`iPhone 17 Pro — iOS 26.5`", "`iPhone 16 — iOS 26.5`")
    .replace("- [x] Completed Guideline 2.1 evidence check 13.", "- [ ] Pending.");

  const failures = validateReleaseRecord(record, incompleteEvidence);
  assert.equal(
    failures.includes("release evidence hashes are missing or do not match the supplied files"),
    true,
  );
  assert.equal(
    failures.includes("Guideline 2.1 response does not complete all seven requested answers"),
    true,
  );
  assert.equal(
    failures.includes("Guideline 2.1 physical-device recording provenance is incomplete"),
    true,
  );
});
