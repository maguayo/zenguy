#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAppAgeRatingContract } from "./app-age-rating-contract.mjs";
import { validateAppPrivacyContract } from "./app-privacy-contract.mjs";
import { validateExistingAccountOnlyContract } from "./existing-account-only-contract.mjs";
import {
  postReleasePhases,
  postReleaseSignals,
} from "./post-release-monitoring-contract.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");
const docsRoot = join(repositoryRoot, "docs", "app-store");
const failures = [];

function fail(message) {
  failures.push(message);
}

for (const failure of validateAppAgeRatingContract()) {
  fail(`app age rating: ${failure}`);
}
for (const failure of validateAppPrivacyContract()) {
  fail(`app privacy: ${failure}`);
}
for (const failure of validateExistingAccountOnlyContract(appRoot)) {
  fail(`existing-account-only: ${failure}`);
}

function normalized(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function readDocument(filename) {
  return readFileSync(join(docsRoot, filename), "utf8");
}

const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const storeConfigSource = readFileSync(join(appRoot, "store.config.json"), "utf8");
const storeConfig = JSON.parse(storeConfigSource);
const metadata = readDocument("metadata-en-US.md");
const reviewAccount = readDocument("review-account.md");
const reviewNotes = readDocument("review-notes-en-US.md");
const screenshots = readDocument("screenshots-en-US.md");
const smokeTest = readDocument("release-smoke-test.md");
const releaseRecordTemplateSource = readDocument("release-record.template.json");
const releaseRecordTemplate = JSON.parse(releaseRecordTemplateSource);
const postReleaseTemplateSource = readDocument(
  "post-release-monitoring.template.json",
);
const postReleaseTemplate = JSON.parse(postReleaseTemplateSource);
const contentRights = readDocument("content-rights.md");
const screenshotFlow = readFileSync(
  join(appRoot, "maestro", "app-store-screenshots.yaml"),
  "utf8",
);
const seedSource = readFileSync(
  join(repositoryRoot, "apps", "api", "scripts", "seed.mjs"),
  "utf8",
);
const normalizedReviewAccount = normalized(reviewAccount);
const normalizedReviewNotes = normalized(reviewNotes);

function validateCountedField(label, pattern, maximum, bytes = false) {
  const match = pattern.exec(metadata);
  if (match === null) {
    fail(`metadata: missing ${label}`);
    return;
  }
  const declared = Number(match[1]);
  const declaredMaximum = Number(match[2]);
  const value = normalized(match[3]);
  const actual = bytes ? Buffer.byteLength(value) : [...value].length;
  if (declared !== actual || declaredMaximum !== maximum || actual > maximum) {
    fail(
      `metadata: ${label} declares ${declared}/${declaredMaximum}, actual ${actual}/${maximum}`,
    );
  }
}

const versionHeadings = [...metadata.matchAll(/^## Version (\d+\.\d+\.\d+)$/gmu)].map(
  (match) => match[1],
);
if (JSON.stringify(versionHeadings) !== JSON.stringify([packageJson.version])) {
  fail(`metadata: version heading must be exactly ${packageJson.version}`);
}
validateCountedField(
  "name",
  /^\| Name \((\d+)\/(\d+)\) \| `([^`]+)` \|$/mu,
  30,
);
validateCountedField(
  "subtitle",
  /^\| Subtitle \((\d+)\/(\d+)\) \| `([^`]+)` \|$/mu,
  30,
);
validateCountedField(
  "promotional text",
  /### Promotional text \((\d+)\/(\d+)\)\n\n([\s\S]*?)\n\n### Description/u,
  170,
);
validateCountedField(
  "keywords",
  /### Keywords \((\d+)\/(\d+) bytes in ASCII\)\n\n`([^`]+)`/u,
  100,
  true,
);

const keywordMatch = /### Keywords \(\d+\/\d+ bytes in ASCII\)\n\n`([^`]+)`/u.exec(
  metadata,
);
if (keywordMatch !== null) {
  const keywords = keywordMatch[1].split(",");
  if (
    !/^[\x20-\x7E]+$/u.test(keywordMatch[1]) ||
    keywords.some((keyword) => keyword.trim() !== keyword || keyword === "") ||
    new Set(keywords).size !== keywords.length
  ) {
    fail("metadata: keywords must be unique, non-empty ASCII values without padding");
  }
}

const description = normalized(
  /### Description\n\n([\s\S]*?)\n\n### Keywords/u.exec(metadata)?.[1] ?? "",
);
if (description.length === 0 || [...description].length > 4_000) {
  fail("metadata: description must contain between 1 and 4,000 characters");
}
for (const invariant of [
  "requires a pre-existing Zenguy account, workspace and active access",
  "does not offer account or workspace registration, purchases, subscriptions, prices or payment management",
]) {
  if (!description.includes(invariant)) {
    fail(`metadata: missing existing-account-only promise: ${invariant}`);
  }
}
for (const invariant of [
  "| Privacy Policy URL | `https://zenguy.com/privacy/` |",
  "| User Privacy Choices URL | `https://zenguy.com/privacy-choices/` |",
  "| Support URL | `https://zenguy.com/support/` |",
  "| Marketing URL | `https://zenguy.com/` |",
  "- Price: Free.",
  "- Release: Manually release this version.",
  "- Platforms: iPhone only (`supportsTablet: false`).",
]) {
  if (!metadata.includes(invariant)) fail(`metadata: missing release invariant ${invariant}`);
}
if (metadata.includes("http://") || /<[A-Z][A-Z0-9_]+>/u.test(metadata)) {
  fail("metadata: insecure URL or unresolved release placeholder");
}

const storeApple = storeConfig.apple;
const storeInfo = storeApple?.info?.["en-US"];
const expectedStoreRootKeys = ["apple", "configVersion"];
const expectedStoreAppleKeys = ["categories", "copyright", "info", "release", "version"];
const expectedStoreInfoKeys = [
  "description",
  "keywords",
  "marketingUrl",
  "privacyChoicesUrl",
  "privacyPolicyUrl",
  "promoText",
  "subtitle",
  "supportUrl",
  "title",
];
if (
  storeConfig.configVersion !== 0 ||
  JSON.stringify(Object.keys(storeConfig).sort()) !== JSON.stringify(expectedStoreRootKeys) ||
  JSON.stringify(Object.keys(storeApple ?? {}).sort()) !==
    JSON.stringify(expectedStoreAppleKeys) ||
  JSON.stringify(Object.keys(storeApple?.info ?? {})) !== JSON.stringify(["en-US"]) ||
  JSON.stringify(Object.keys(storeInfo ?? {}).sort()) !== JSON.stringify(expectedStoreInfoKeys)
) {
  fail(
    "store config: must remain the exact non-secret en-US metadata subset; review credentials, App Privacy and advisory answers stay manual",
  );
}
if (
  storeApple?.version !== packageJson.version ||
  storeApple?.copyright !== "2026 NIESAYO GROUP, S.L." ||
  JSON.stringify(storeApple?.categories) !==
    JSON.stringify(["DEVELOPER_TOOLS", "BUSINESS"]) ||
  JSON.stringify(storeApple?.release) !==
    JSON.stringify({ automaticRelease: false, phasedRelease: false })
) {
  fail("store config: version, ownership, categories or manual release policy drifted");
}
const expectedStoreTitle =
  /^\| Name \(\d+\/\d+\) \| `([^`]+)` \|$/mu.exec(metadata)?.[1] ?? "";
const expectedStoreSubtitle =
  /^\| Subtitle \(\d+\/\d+\) \| `([^`]+)` \|$/mu.exec(metadata)?.[1] ?? "";
const expectedStorePromo = normalized(
  /### Promotional text \(\d+\/\d+\)\n\n([\s\S]*?)\n\n### Description/u.exec(metadata)?.[1] ?? "",
);
const expectedStoreKeywords = keywordMatch?.[1].split(",") ?? [];
if (
  storeInfo?.title !== expectedStoreTitle ||
  storeInfo?.subtitle !== expectedStoreSubtitle ||
  normalized(storeInfo?.description ?? "") !== description ||
  normalized(storeInfo?.promoText ?? "") !== expectedStorePromo ||
  JSON.stringify(storeInfo?.keywords) !== JSON.stringify(expectedStoreKeywords) ||
  storeInfo?.marketingUrl !== "https://zenguy.com/" ||
  storeInfo?.supportUrl !== "https://zenguy.com/support/" ||
  storeInfo?.privacyPolicyUrl !== "https://zenguy.com/privacy/" ||
  storeInfo?.privacyChoicesUrl !== "https://zenguy.com/privacy-choices/"
) {
  fail("store config: localized copy or URLs do not exactly match metadata-en-US.md");
}
if (
  /<[A-Z][A-Z0-9_]+>/u.test(storeConfigSource) ||
  /"(?:demoUsername|demoPassword|review)"\s*:/u.test(storeConfigSource)
) {
  fail("store config: review contacts or credentials must never be committed");
}

const expectedReviewPlaceholders = [
  "REVIEW_CONTACT_FIRST_NAME",
  "REVIEW_CONTACT_LAST_NAME",
  "REVIEW_CONTACT_PHONE_WITH_COUNTRY_CODE",
  "MONITORED_REVIEW_CONTACT_EMAIL",
  "REVIEW_ACCOUNT_EMAIL",
  "REVIEW_ACCOUNT_PASSWORD",
  "SCREEN_RECORDING_FILENAME",
  "TESTED_DEVICE_LIST",
];
const reviewPlaceholders = [
  ...reviewNotes.matchAll(/<([A-Z][A-Z0-9_]+)>/gu),
].map((match) => match[1]);
if (JSON.stringify(reviewPlaceholders) !== JSON.stringify(expectedReviewPlaceholders)) {
  fail("review notes: credential/contact placeholders changed or were committed as values");
}
if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(reviewNotes)) {
  fail("review notes: a literal email address must not be committed");
}
for (const invariant of [
  "already supplied a Zenguy account, workspace and active access",
  "does not create accounts or workspaces",
  "sell or activate subscriptions",
  "Guideline 2.1 information",
  "Physical-device recording",
  "Devices and operating systems tested before submission",
  "External services",
  "Regions:",
  "Regulation and rights",
  "https://zenguy.com/support/",
  "https://zenguy.com/privacy/",
  "https://zenguy.com/privacy-choices/",
]) {
  if (!normalizedReviewNotes.includes(invariant)) {
    fail(`review notes: missing reviewer invariant ${invariant}`);
  }
}

const guideline21Response = readDocument("review-response-guideline-2.1.md");
const expectedGuideline21Placeholders = [
  "VERSION",
  "BUILD",
  "FULL_COMMIT_SHA",
  "EAS_BUILD_URL",
  "EAS_SUBMISSION_URL",
  "RUNTIME_VERSION",
  "EAS_BUILD_FINGERPRINT",
  "SCREEN_RECORDING_FILENAME",
  "SCREEN_RECORDING_SHA256",
  "MODEL",
  "IOS_VERSION",
  "ISO_TIMESTAMP_WITH_ZONE",
  "HH_MM_SS",
  "TESTED_DEVICE_LIST",
];
const guideline21Placeholders = [
  ...guideline21Response.matchAll(/<([A-Z][A-Z0-9_]+)>/gu),
].map((match) => match[1]);
if (
  JSON.stringify(guideline21Placeholders) !==
  JSON.stringify(expectedGuideline21Placeholders)
) {
  fail(
    "Guideline 2.1 response: candidate placeholders changed or were filled in the source template",
  );
}
const guideline21Unchecked =
  guideline21Response.match(/^- \[ \]/gmu)?.length ?? 0;
if (guideline21Unchecked !== 13 || /^- \[[xX]\]/mu.test(guideline21Response)) {
  fail(
    "Guideline 2.1 response: source checklist must contain exactly 13 uncompleted sign-offs",
  );
}
for (const invariant of [
  "## 1 — Physical-device screen recording",
  "## 2 — Devices and operating systems tested",
  "## 3 — Functions, target audience and value",
  "## 4 — Access and setup instructions",
  "## 5 — External services, tools and platforms",
  "## 6 — Regional differences",
  "## 7 — Regulation and content rights",
  "cb0ae8b7-769b-485a-93a6-1e9846e6c298",
  "0.2.0 (3)",
  "0.2.1 (4)",
  "separate disposable account",
  "no registration, price, purchase, subscription or payment flow",
]) {
  if (!guideline21Response.includes(invariant)) {
    fail(`Guideline 2.1 response: missing required evidence ${invariant}`);
  }
}

for (const demoLabel of ["Blog listing", "Status API", "Search filters"]) {
  for (const [sourceName, source] of [
    ["review notes", reviewNotes],
    ["screenshot flow", screenshotFlow],
    ["local fixture source", seedSource],
  ]) {
    if (!source.includes(demoLabel)) {
      fail(`${sourceName}: missing shared demo label ${demoLabel}`);
    }
  }
}

for (const invariant of [
  "exactly one production workspace with `ACTIVE` access",
  "pnpm verify:app-review-account",
  "MAESTRO_REVIEW_EMAIL",
  "MAESTRO_REVIEW_PASSWORD",
  "signs in twice",
  "Use a separate disposable account for the deletion test",
]) {
  if (!normalizedReviewAccount.includes(invariant)) {
    fail(`review account: missing credential/demo invariant ${invariant}`);
  }
}

for (const invariant of [
  "1320 × 2868 px",
  "MAESTRO_REVIEW_EMAIL",
  "MAESTRO_REVIEW_PASSWORD",
  "pnpm prepare:app-store-screenshots",
  `--version ${packageJson.version}`,
  "app-store-screenshots.json",
  "SHA-256",
]) {
  if (!screenshots.includes(invariant)) {
    fail(`screenshots: missing capture/QA invariant ${invariant}`);
  }
}

const expectedSmokePlaceholders = [
  "VERSION",
  "BUILD",
  "FULL_COMMIT_SHA",
  "EAS_BUILD_URL",
  "EAS_SUBMISSION_URL",
  "RUNTIME_VERSION",
  "EAS_BUILD_FINGERPRINT",
  "VALID_AND_IN_BETA_TESTING",
  "NAME",
  "MODEL",
  "IOS_VERSION",
  "ISO_TIMESTAMP_WITH_ZONE",
  "NOTES_AND_LINKS",
];
const smokePlaceholders = [...smokeTest.matchAll(/<([A-Z][A-Z0-9_]+)>/gu)].map(
  (match) => match[1],
);
if (JSON.stringify(smokePlaceholders) !== JSON.stringify(expectedSmokePlaceholders)) {
  fail("smoke-test template: candidate placeholders changed or were filled in the source template");
}
if (/^- \[[xX]\]/mu.test(smokeTest)) {
  fail("smoke-test template: source checklist must remain uncompleted");
}
const normalizedSmokeTest = normalized(smokeTest);
for (const invariant of [
  "Installed the exact build from TestFlight on a physical iPhone",
  "There is no sign-up, create-account or create-workspace control",
  "There is no price, purchase, subscription activation, checkout, billing",
  "Account reports the same native version and build as EAS and App Store Connect",
]) {
  if (!normalizedSmokeTest.includes(invariant)) {
    fail(`smoke-test template: missing candidate invariant ${invariant}`);
  }
}

const expectedReleaseRecordPlaceholders = [
  "VERSION",
  "BUILD",
  "FULL_COMMIT_SHA",
  "RUNTIME_VERSION",
  "EAS_BUILD_FINGERPRINT",
  "EAS_BUILD_UUID",
  "EAS_BUILD_URL",
  "EAS_SUBMISSION_UUID",
  "EAS_SUBMISSION_URL",
  "APPLE_TERRITORY_ID",
  "APP_REVIEW_RESPONSE_SHA256",
  "PRIVACY_REPORT_SHA256",
  "SCREENSHOTS_MANIFEST_SHA256",
  "SCREEN_RECORDING_FILENAME",
  "SCREEN_RECORDING_SHA256",
  "SMOKE_TEST_RECORD_SHA256",
  "ISO_TIMESTAMP_WITH_ZONE",
  "CREDENTIAL_OWNER",
  "ISO_TIMESTAMP_WITH_ZONE",
];
const releaseRecordPlaceholders = [
  ...releaseRecordTemplateSource.matchAll(/<([A-Z][A-Z0-9_]+)>/gu),
].map((match) => match[1]);
const releaseSignoffKeys = [
  "agreementsAndTraderStatusVerified",
  "ageRatingSaved",
  "appPrivacyPublished",
  "contentRightsConfirmed",
  "guideline21ResponseSaved",
  "metadataSaved",
  "physicalDeviceScreenRecordingAttached",
  "physicalDeviceSmokeTestPassed",
  "privacyReportReconciled",
  "publicUrlsVerified",
  "reviewAccountVerified",
  "screenshotsReviewedAt100Percent",
  "signedArchiveVerified",
];
if (
  JSON.stringify(releaseRecordPlaceholders) !==
  JSON.stringify(expectedReleaseRecordPlaceholders)
) {
  fail("release-record template: placeholders changed or were filled in the source template");
}
if (
  releaseRecordTemplate.schemaVersion !== 5 ||
  !hasExactKeys(releaseRecordTemplate, [
    "ageRating",
    "app",
    "appReview",
    "candidate",
    "credentials",
    "distribution",
    "evidence",
    "recordedAt",
    "schemaVersion",
    "signoffs",
  ]) ||
  JSON.stringify(releaseRecordTemplate.app) !==
    JSON.stringify({
      name: "Zenguy",
      bundleIdentifier: "com.zenguy.app",
      appleTeamId: "HT84Q65URB",
      ascAppId: "6804201911",
      easProjectId: "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7",
    }) ||
  JSON.stringify(releaseRecordTemplate.ageRating) !==
    JSON.stringify({
      sourceReconciledOn: "2026-09-01",
      calculatedGlobalRating: "4+",
      madeForKids: "NOT_APPLICABLE",
      overrideToHigherAgeRating: "18+",
      displayGlobalRating: "18+",
    }) ||
  !hasExactKeys(releaseRecordTemplate.candidate, [
    "apiOrigin",
    "appleBuildState",
    "build",
    "channel",
    "commit",
    "easBuildId",
    "easBuildStatus",
    "easBuildUrl",
    "easSubmissionId",
    "easSubmissionStatus",
    "easSubmissionUrl",
    "easBuildFingerprint",
    "runtimeVersion",
    "testFlightState",
    "version",
  ]) ||
  releaseRecordTemplate.candidate?.version !== "<VERSION>" ||
  releaseRecordTemplate.candidate?.build !== "<BUILD>" ||
  releaseRecordTemplate.candidate?.commit !== "<FULL_COMMIT_SHA>" ||
  releaseRecordTemplate.candidate?.runtimeVersion !== "<RUNTIME_VERSION>" ||
  releaseRecordTemplate.candidate?.easBuildFingerprint !== "<EAS_BUILD_FINGERPRINT>" ||
  releaseRecordTemplate.candidate?.easBuildId !== "<EAS_BUILD_UUID>" ||
  releaseRecordTemplate.candidate?.easBuildUrl !== "<EAS_BUILD_URL>" ||
  releaseRecordTemplate.candidate?.easSubmissionId !== "<EAS_SUBMISSION_UUID>" ||
  releaseRecordTemplate.candidate?.easSubmissionUrl !== "<EAS_SUBMISSION_URL>" ||
  releaseRecordTemplate.candidate?.apiOrigin !== "https://api.zenguy.com" ||
  releaseRecordTemplate.candidate?.channel !== "production" ||
  releaseRecordTemplate.candidate?.easBuildStatus !== "FINISHED" ||
  releaseRecordTemplate.candidate?.easSubmissionStatus !== "FINISHED" ||
  releaseRecordTemplate.candidate?.appleBuildState !== "VALID" ||
  releaseRecordTemplate.candidate?.testFlightState !== "IN_BETA_TESTING" ||
  !hasExactKeys(releaseRecordTemplate.distribution, [
    "automaticTestFlightDistribution",
    "phasedRelease",
    "releaseMethod",
    "storefronts",
    "testFlightGroup",
  ]) ||
  releaseRecordTemplate.distribution?.testFlightGroup !== "Zenguy Internal" ||
  releaseRecordTemplate.distribution?.automaticTestFlightDistribution !== true ||
  releaseRecordTemplate.distribution?.releaseMethod !== "MANUAL" ||
  releaseRecordTemplate.distribution?.phasedRelease !== false ||
  JSON.stringify(releaseRecordTemplate.distribution?.storefronts) !==
    JSON.stringify(["<APPLE_TERRITORY_ID>"]) ||
  !hasExactKeys(releaseRecordTemplate.evidence, [
    "appReviewResponseSha256",
    "privacyReportSha256",
    "screenshotsManifestSha256",
    "screenRecordingFilename",
    "screenRecordingSha256",
    "smokeTestRecordSha256",
  ]) ||
  JSON.stringify(releaseRecordTemplate.evidence) !==
    JSON.stringify({
      appReviewResponseSha256: "<APP_REVIEW_RESPONSE_SHA256>",
      privacyReportSha256: "<PRIVACY_REPORT_SHA256>",
      screenshotsManifestSha256: "<SCREENSHOTS_MANIFEST_SHA256>",
      screenRecordingFilename: "<SCREEN_RECORDING_FILENAME>",
      screenRecordingSha256: "<SCREEN_RECORDING_SHA256>",
      smokeTestRecordSha256: "<SMOKE_TEST_RECORD_SHA256>",
    }) ||
  !hasExactKeys(releaseRecordTemplate.signoffs, releaseSignoffKeys) ||
  releaseSignoffKeys.some((key) => releaseRecordTemplate.signoffs[key] !== false) ||
  JSON.stringify(releaseRecordTemplate.credentials) !==
    JSON.stringify({
      reviewedAt: "<ISO_TIMESTAMP_WITH_ZONE>",
      responsible: "<CREDENTIAL_OWNER>",
      distributionCertificateSerial: "6A5F4472F596BA3F5C6E50D700221A8",
      distributionCertificateExpiresOn: "2027-07-25",
      provisioningProfileId: "YNK325M2FS",
      provisioningProfileExpiresOn: "2027-07-25",
      apnsKeyId: "8UDV42545G",
      ascApiKeyId: "U3MR73JGPS",
    }) ||
  JSON.stringify(releaseRecordTemplate.appReview) !==
    JSON.stringify({
      stage: "REVIEW_READY",
      status: "READY_FOR_REVIEW",
      submittedAt: null,
      approvedAt: null,
      releasedAt: null,
      appStoreUrl: null,
    }) ||
  releaseRecordTemplate.recordedAt !== "<ISO_TIMESTAMP_WITH_ZONE>"
) {
  fail("release-record template: app, candidate, distribution or sign-off contract drifted");
}

const postReleaseCandidate = postReleaseTemplate.candidate;
const postReleaseOwners = postReleaseTemplate.owners;
const postReleaseRenewal = postReleaseTemplate.credentialRenewal;
const postReleaseCheckpoints = Array.isArray(postReleaseTemplate.checkpoints)
  ? postReleaseTemplate.checkpoints
  : [];
if (
  postReleaseTemplate.schemaVersion !== 1 ||
  !hasExactKeys(postReleaseTemplate, [
    "candidate",
    "checkpoints",
    "completedAt",
    "credentialRenewal",
    "incidents",
    "owners",
    "releaseRecordSha256",
    "schemaVersion",
  ]) ||
  postReleaseTemplate.releaseRecordSha256 !==
    "<RELEASED_RELEASE_RECORD_SHA256>" ||
  JSON.stringify(postReleaseCandidate) !==
    JSON.stringify({
      version: "<VERSION>",
      build: "<BUILD>",
      commit: "<FULL_COMMIT_SHA>",
      easBuildId: "<EAS_BUILD_UUID>",
      easBuildUrl: "<EAS_BUILD_URL>",
      easSubmissionId: "<EAS_SUBMISSION_UUID>",
      easSubmissionUrl: "<EAS_SUBMISSION_URL>",
      appStoreUrl: "<APP_STORE_URL>",
      releasedAt: "<RELEASED_AT_WITH_ZONE>",
    }) ||
  JSON.stringify(postReleaseOwners) !==
    JSON.stringify({
      operations: "<OPERATIONS_OWNER>",
      support: "<SUPPORT_OWNER>",
      credentials: "<CREDENTIAL_OWNER>",
    }) ||
  JSON.stringify(postReleaseRenewal) !==
    JSON.stringify({
      distributionCertificateExpiresOn: "<DISTRIBUTION_CERTIFICATE_EXPIRY>",
      provisioningProfileExpiresOn: "<PROVISIONING_PROFILE_EXPIRY>",
      nextReviewOn: "<NEXT_CREDENTIAL_REVIEW_DATE>",
    }) ||
  postReleaseCheckpoints.length !== postReleasePhases.length ||
  postReleaseCheckpoints.some(
    (checkpoint, index) =>
      !hasExactKeys(checkpoint, ["observedAt", "phase", "signals"]) ||
      checkpoint.phase !== postReleasePhases[index] ||
      !/^<[A-Z][A-Z0-9_]+>$/u.test(checkpoint.observedAt ?? "") ||
      !hasExactKeys(checkpoint.signals, postReleaseSignals) ||
      postReleaseSignals.some(
        (signal) =>
          !hasExactKeys(checkpoint.signals[signal], ["evidence", "status"]) ||
          checkpoint.signals[signal].status !== "PENDING" ||
          !/^<[A-Z][A-Z0-9_]+>$/u.test(
            checkpoint.signals[signal].evidence ?? "",
          ),
      ),
  ) ||
  JSON.stringify(postReleaseTemplate.incidents) !== "[]" ||
  postReleaseTemplate.completedAt !== "<COMPLETED_AT_WITH_ZONE>" ||
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(
    postReleaseTemplateSource,
  )
) {
  fail("post-release template: 48-hour monitoring contract drifted or was completed in source");
}

const expectedAssetPaths = [
  "icon.png",
  "splash-icon.png",
  "icon-logo.svg",
  "fonts/OFL.txt",
];
const documentedAssets = [
  ...contentRights.matchAll(/^([0-9a-f]{64}) {2}(.+)$/gmu),
].map((match) => ({ digest: match[1], path: match[2] }));
if (
  JSON.stringify(documentedAssets.map(({ path }) => path)) !==
  JSON.stringify(expectedAssetPaths)
) {
  fail("content rights: the exact four candidate asset checksums must be documented");
} else {
  for (const asset of documentedAssets) {
    const bytes = readFileSync(join(appRoot, "assets", asset.path));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.digest) {
      fail(`content rights: stale SHA-256 for ${asset.path}`);
    }
  }
}
if (/^- \[[xX]\]/mu.test(contentRights)) {
  fail("content-rights source: owner/reviewer sign-off must remain manual and uncompleted");
}

function pngHeader(path) {
  const bytes = readFileSync(path);
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) return null;
  return {
    bitDepth: bytes[24],
    colorType: bytes[25],
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

const icon = pngHeader(join(appRoot, "assets", "icon.png"));
if (
  icon === null ||
  icon.width !== 1024 ||
  icon.height !== 1024 ||
  icon.bitDepth !== 8 ||
  icon.colorType !== 2
) {
  fail("content rights: App Store icon must be a 1024 × 1024 8-bit RGB PNG without alpha");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `App Store source package verified for Zenguy ${packageJson.version} (existing-account-only client, metadata, age rating, App Privacy, review account, Guideline 2.1 evidence, screenshots, smoke test, release record, post-release monitoring and rights).`,
  );
}
