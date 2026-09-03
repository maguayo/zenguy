const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const fullCommitPattern = /^[0-9a-f]{40}$/u;
const easFingerprintPattern = /^[0-9a-f]{40}$/u;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    validDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function smokeValue(source, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\| ${escapedLabel} \\| ` + "`([^`]+)`" + " \\|$", "mu").exec(
    source,
  )?.[1];
}

function validateSmokeRecord(source, candidate, recordedAt, failures) {
  if (typeof source !== "string") {
    failures.push("smoke-test record is missing or unreadable");
    return;
  }
  if (/<[A-Z][A-Z0-9_]+>/u.test(source)) {
    failures.push("smoke-test record contains unresolved placeholders");
    return;
  }
  const unchecked = [...source.matchAll(/^- \[ \] (.+)$/gmu)].map((match) => match[1]);
  const checkedCount = (source.match(/^- \[[xX]\] /gmu) ?? []).length;
  if (
    JSON.stringify(unchecked) !== JSON.stringify(["FAIL — do not submit."]) ||
    !/^- \[[xX]\] PASS — candidate may be associated with the App Store version\.$/mu.test(
      source,
    ) ||
    checkedCount !== 42
  ) {
    failures.push("smoke-test record is not a complete physical-device PASS");
  }

  const expectedRows = new Map([
    ["Public version", candidate.version],
    ["Apple build number", candidate.build],
    ["Git commit", candidate.commit],
    ["Runtime version", candidate.runtimeVersion],
    ["EAS build fingerprint", candidate.easBuildFingerprint],
    ["API origin", candidate.apiOrigin],
    ["TestFlight status", "VALID / IN_BETA_TESTING"],
  ]);
  for (const [label, expected] of expectedRows) {
    if (smokeValue(source, label) !== expected) {
      failures.push(`smoke-test identity mismatch: ${label}`);
    }
  }
  for (const [label, expectedUrl] of [
    ["EAS build ID / URL", candidate.easBuildUrl],
    ["EAS submission ID / URL", candidate.easSubmissionUrl],
  ]) {
    if (smokeValue(source, label) !== expectedUrl) {
      failures.push(`smoke-test identity mismatch: ${label}`);
    }
  }

  const tester = smokeValue(source, "Tester") ?? "";
  const model = smokeValue(source, "Physical iPhone model") ?? "";
  const iosVersion = smokeValue(source, "iOS version") ?? "";
  const testTimestamp = smokeValue(source, "Test date/time zone");
  const notes = /^Failures, evidence and follow-up:\n\n`([^`\n]+)`$/mu.exec(source)?.[1];
  if (
    tester.trim().length < 2 ||
    tester.length > 100 ||
    tester.includes("@") ||
    !/^iPhone(?:\s|$)/u.test(model) ||
    !/^\d+(?:\.\d+){0,2}$/u.test(iosVersion) ||
    !validTimestamp(testTimestamp) ||
    typeof notes !== "string" ||
    notes.trim().length < 2
  ) {
    failures.push("smoke-test physical-device provenance is incomplete");
  } else if (
    validTimestamp(recordedAt) &&
    Date.parse(testTimestamp) > Date.parse(recordedAt)
  ) {
    failures.push("smoke-test cannot occur after the release record timestamp");
  }
}

function validateGuideline21Response(
  source,
  candidate,
  recordedAt,
  { screenRecordingFilename, screenRecordingSha256 },
  failures,
) {
  if (typeof source !== "string") {
    failures.push("Guideline 2.1 response is missing or unreadable");
    return;
  }
  if (
    /<[A-Z][A-Z0-9_]+>/u.test(source) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(source) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|access token|refresh token)\s*[:=]/iu.test(
      source,
    )
  ) {
    failures.push("Guideline 2.1 response contains placeholders or forbidden sensitive material");
    return;
  }

  const headings = [
    "## 1 — Physical-device screen recording",
    "## 2 — Devices and operating systems tested",
    "## 3 — Functions, target audience and value",
    "## 4 — Access and setup instructions",
    "## 5 — External services, tools and platforms",
    "## 6 — Regional differences",
    "## 7 — Regulation and content rights",
  ];
  const uncheckedCount = (source.match(/^- \[ \] /gmu) ?? []).length;
  const checkedCount = (source.match(/^- \[[xX]\] /gmu) ?? []).length;
  if (
    headings.some((heading) => !source.includes(heading)) ||
    uncheckedCount !== 0 ||
    checkedCount !== 13
  ) {
    failures.push("Guideline 2.1 response does not complete all seven requested answers");
  }

  const expectedRows = new Map([
    ["Public version", candidate.version],
    ["Apple build number", candidate.build],
    ["Git commit", candidate.commit],
    ["EAS build ID / URL", candidate.easBuildUrl],
    ["EAS submission ID / URL", candidate.easSubmissionUrl],
    ["Runtime version", candidate.runtimeVersion],
    ["EAS build fingerprint", candidate.easBuildFingerprint],
    ["API origin", candidate.apiOrigin],
    ["Attachment filename", screenRecordingFilename],
    ["Attachment SHA-256", screenRecordingSha256],
  ]);
  for (const [label, expected] of expectedRows) {
    if (smokeValue(source, label) !== expected) {
      failures.push(`Guideline 2.1 response identity mismatch: ${label}`);
    }
  }

  const model = smokeValue(source, "Physical iPhone model") ?? "";
  const iosVersion = smokeValue(source, "iOS version") ?? "";
  const capturedAt = smokeValue(source, "Captured at");
  const duration = smokeValue(source, "Duration") ?? "";
  const deviceList =
    /## 2 — Devices and operating systems tested\n\n`([^`\n]+)`/mu.exec(source)?.[1] ??
    "";
  const durationMatch = /^(\d{2}):(\d{2}):(\d{2})$/u.exec(duration);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 +
      Number(durationMatch[2]) * 60 +
      Number(durationMatch[3])
    : Number.NaN;
  if (
    !/^iPhone(?:\s|$)/u.test(model) ||
    !/^\d+(?:\.\d+){0,2}$/u.test(iosVersion) ||
    !validTimestamp(capturedAt) ||
    !/^iPhone [^;<>\n]{1,80} — iOS \d+(?:\.\d+){0,2}(?:; iPhone [^;<>\n]{1,80} — iOS \d+(?:\.\d+){0,2})*$/u.test(
      deviceList,
    ) ||
    !deviceList.split("; ").includes(`${model} — iOS ${iosVersion}`) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 30 ||
    durationSeconds > 30 * 60
  ) {
    failures.push("Guideline 2.1 physical-device recording provenance is incomplete");
  } else if (
    validTimestamp(recordedAt) &&
    Date.parse(capturedAt) > Date.parse(recordedAt)
  ) {
    failures.push("Guideline 2.1 recording cannot occur after the release record timestamp");
  }
}

function validateScreenshotManifest(manifest, candidate, recordedAt, failures) {
  const expectedFiles = [
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
  ];
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const validFiles = files.every((file, index) => {
    const expected = expectedFiles[index];
    return (
      expected !== undefined &&
      exactKeys(file, [
        "caption",
        "filename",
        "format",
        "hasAlpha",
        "height",
        "sha256",
        "sizeBytes",
        "source",
        "width",
      ]) &&
      file.filename === expected[0] &&
      file.source === expected[1] &&
      file.caption === expected[2] &&
      file.format === "JPEG" &&
      file.hasAlpha === false &&
      file.width === 1320 &&
      file.height === 2868 &&
      Number.isSafeInteger(file.sizeBytes) &&
      file.sizeBytes >= 50_000 &&
      file.sizeBytes <= 10_000_000 &&
      sha256Pattern.test(file.sha256 ?? "")
    );
  });
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.app !== "Zenguy" ||
    manifest.locale !== "en-US" ||
    manifest.version !== candidate.version ||
    manifest.build !== candidate.build ||
    manifest.commit !== candidate.commit ||
    manifest.easBuildId !== candidate.easBuildId ||
    manifest.easSubmissionId !== candidate.easSubmissionId ||
    !validTimestamp(manifest.generatedAt) ||
    files.length !== expectedFiles.length ||
    !validFiles ||
    new Set(files.map((file) => file.sha256)).size !== expectedFiles.length
  ) {
    failures.push("screenshot manifest does not identify the exact candidate");
  } else if (
    validTimestamp(recordedAt) &&
    Date.parse(manifest.generatedAt) > Date.parse(recordedAt)
  ) {
    failures.push("screenshot capture cannot occur after the release record timestamp");
  }
}

function validateReviewLifecycle(appReview, recordedAt, failures) {
  if (
    !exactKeys(appReview, [
      "appStoreUrl",
      "approvedAt",
      "releasedAt",
      "stage",
      "status",
      "submittedAt",
    ])
  ) {
    failures.push("App Review lifecycle keys are not exact");
    return;
  }

  const stage = appReview.stage;
  const validSubmittedAt = validTimestamp(appReview.submittedAt);
  const validApprovedAt = validTimestamp(appReview.approvedAt);
  const validReleasedAt = validTimestamp(appReview.releasedAt);
  if (
    stage === "REVIEW_READY" &&
    !(
      appReview.status === "READY_FOR_REVIEW" &&
      appReview.submittedAt === null &&
      appReview.approvedAt === null &&
      appReview.releasedAt === null &&
      appReview.appStoreUrl === null
    )
  ) {
    failures.push("REVIEW_READY lifecycle must remain unsubmitted");
  } else if (
    stage === "SUBMITTED" &&
    !(
      ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(appReview.status) &&
      validSubmittedAt &&
      appReview.approvedAt === null &&
      appReview.releasedAt === null &&
      appReview.appStoreUrl === null
    )
  ) {
    failures.push("SUBMITTED lifecycle is incomplete or inconsistent");
  } else if (
    stage === "APPROVED" &&
    !(
      appReview.status === "PENDING_DEVELOPER_RELEASE" &&
      validSubmittedAt &&
      validApprovedAt &&
      appReview.releasedAt === null &&
      appReview.appStoreUrl === null
    )
  ) {
    failures.push("APPROVED lifecycle is incomplete or inconsistent");
  } else if (
    stage === "RELEASED" &&
    !(
      appReview.status === "READY_FOR_DISTRIBUTION" &&
      validSubmittedAt &&
      validApprovedAt &&
      validReleasedAt &&
      typeof appReview.appStoreUrl === "string" &&
      /^https:\/\/apps\.apple\.com\/(?:[^?#]+\/)?id6804201911$/u.test(
        appReview.appStoreUrl,
      )
    )
  ) {
    failures.push("RELEASED lifecycle is incomplete or inconsistent");
  } else if (!["REVIEW_READY", "SUBMITTED", "APPROVED", "RELEASED"].includes(stage)) {
    failures.push("App Review lifecycle stage is invalid");
  }

  const orderedTimes = [
    appReview.submittedAt,
    appReview.approvedAt,
    appReview.releasedAt,
    recordedAt,
  ]
    .filter((value) => value !== null && validTimestamp(value))
    .map((value) => Date.parse(value));
  if (orderedTimes.some((value, index) => index > 0 && value < orderedTimes[index - 1])) {
    failures.push("App Review lifecycle timestamps are not chronological");
  }
}

export function validateReleaseRecord(
  record,
  {
    ageRatingConfig,
    appReviewResponseSha256,
    appReviewResponseSource,
    packageVersion,
    screenshotsManifest,
    screenshotsManifestSha256,
    smokeTestSource,
    smokeTestRecordSha256,
    privacyReportSha256,
    screenRecordingFilename,
    screenRecordingSha256,
  } = {},
) {
  const failures = [];
  if (/<[A-Z][A-Z0-9_]+>/u.test(JSON.stringify(record))) {
    failures.push("release record contains unresolved placeholders");
  }
  if (
    !exactKeys(record, [
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
    record?.schemaVersion !== 5
  ) {
    failures.push("release record root/schema keys are not exact");
  }

  const app = record?.app;
  if (
    !exactKeys(app, ["appleTeamId", "ascAppId", "bundleIdentifier", "easProjectId", "name"]) ||
    JSON.stringify(app) !==
      JSON.stringify({
        name: "Zenguy",
        bundleIdentifier: "com.zenguy.app",
        appleTeamId: "HT84Q65URB",
        ascAppId: "6804201911",
        easProjectId: "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7",
      })
  ) {
    failures.push("release record identifies the wrong app, Apple team or EAS project");
  }

  if (
    !exactKeys(record?.ageRating, [
      "calculatedGlobalRating",
      "displayGlobalRating",
      "madeForKids",
      "overrideToHigherAgeRating",
      "sourceReconciledOn",
    ]) ||
    JSON.stringify(record.ageRating) !==
      JSON.stringify({
        sourceReconciledOn: "2026-09-01",
        calculatedGlobalRating: "4+",
        madeForKids: "NOT_APPLICABLE",
        overrideToHigherAgeRating: "18+",
        displayGlobalRating: "18+",
      })
  ) {
    failures.push("release record age-rating evidence is not exact");
  }
  const sourceAgeRating = ageRatingConfig?.apple;
  if (
    ageRatingConfig?.configVersion !== 1 ||
    !Array.isArray(sourceAgeRating?.answers) ||
    sourceAgeRating.answers.length !== 24 ||
    JSON.stringify(record?.ageRating) !==
      JSON.stringify({
        sourceReconciledOn: ageRatingConfig?.lastReconciled,
        calculatedGlobalRating: sourceAgeRating?.calculatedGlobalRating,
        madeForKids: sourceAgeRating?.madeForKids,
        overrideToHigherAgeRating:
          sourceAgeRating?.overrideToHigherAgeRating,
        displayGlobalRating: sourceAgeRating?.displayGlobalRating,
      })
  ) {
    failures.push(
      "release record age-rating evidence does not match the candidate source",
    );
  }

  const candidate = record?.candidate ?? {};
  if (
    !exactKeys(candidate, [
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
    candidate.version !== packageVersion ||
    !/^[1-9]\d*$/u.test(candidate.build ?? "") ||
    !Number.isSafeInteger(Number(candidate.build)) ||
    Number(candidate.build) < 6 ||
    !fullCommitPattern.test(candidate.commit ?? "") ||
    candidate.runtimeVersion !== candidate.version ||
    !easFingerprintPattern.test(candidate.easBuildFingerprint ?? "") ||
    !uuidPattern.test(candidate.easBuildId ?? "") ||
    !uuidPattern.test(candidate.easSubmissionId ?? "") ||
    candidate.easBuildUrl !==
      `https://expo.dev/accounts/maguayo/projects/zenguy/builds/${candidate.easBuildId}` ||
    candidate.easSubmissionUrl !==
      `https://expo.dev/accounts/maguayo/projects/zenguy/submissions/${candidate.easSubmissionId}` ||
    candidate.apiOrigin !== "https://api.zenguy.com" ||
    candidate.channel !== "production" ||
    candidate.easBuildStatus !== "FINISHED" ||
    candidate.easSubmissionStatus !== "FINISHED" ||
    candidate.appleBuildState !== "VALID" ||
    candidate.testFlightState !== "IN_BETA_TESTING"
  ) {
    failures.push("candidate identity/status is incomplete, stale or not reviewable");
  }

  const distribution = record?.distribution;
  const storefronts = Array.isArray(distribution?.storefronts)
    ? distribution.storefronts
    : [];
  if (
    !exactKeys(distribution, [
      "automaticTestFlightDistribution",
      "phasedRelease",
      "releaseMethod",
      "storefronts",
      "testFlightGroup",
    ]) ||
    distribution?.testFlightGroup !== "Zenguy Internal" ||
    distribution?.automaticTestFlightDistribution !== true ||
    distribution?.releaseMethod !== "MANUAL" ||
    distribution?.phasedRelease !== false ||
    storefronts.length === 0 ||
    storefronts.some((value) => !/^[A-Z]{3}$/u.test(value)) ||
    new Set(storefronts).size !== storefronts.length ||
    JSON.stringify(storefronts) !== JSON.stringify([...storefronts].sort())
  ) {
    failures.push("TestFlight/release/storefront distribution is not exact and deterministic");
  }

  const evidence = record?.evidence;
  if (
    !exactKeys(evidence, [
      "appReviewResponseSha256",
      "privacyReportSha256",
      "screenshotsManifestSha256",
      "screenRecordingFilename",
      "screenRecordingSha256",
      "smokeTestRecordSha256",
    ]) ||
    !sha256Pattern.test(evidence?.appReviewResponseSha256 ?? "") ||
    !sha256Pattern.test(evidence?.screenshotsManifestSha256 ?? "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:mov|mp4)$/u.test(
      evidence?.screenRecordingFilename ?? "",
    ) ||
    !sha256Pattern.test(evidence?.screenRecordingSha256 ?? "") ||
    !sha256Pattern.test(evidence?.smokeTestRecordSha256 ?? "") ||
    !sha256Pattern.test(evidence?.privacyReportSha256 ?? "") ||
    evidence?.appReviewResponseSha256 !== appReviewResponseSha256 ||
    evidence?.screenshotsManifestSha256 !== screenshotsManifestSha256 ||
    evidence?.screenRecordingFilename !== screenRecordingFilename ||
    evidence?.screenRecordingSha256 !== screenRecordingSha256 ||
    evidence?.smokeTestRecordSha256 !== smokeTestRecordSha256 ||
    evidence?.privacyReportSha256 !== privacyReportSha256
  ) {
    failures.push("release evidence hashes are missing or do not match the supplied files");
  }

  const expectedSignoffs = [
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
    !exactKeys(record?.signoffs, expectedSignoffs) ||
    expectedSignoffs.some((name) => record.signoffs[name] !== true)
  ) {
    failures.push("all review-ready sign-offs must be explicitly true");
  }

  const credentials = record?.credentials;
  if (
    !exactKeys(credentials, [
      "apnsKeyId",
      "ascApiKeyId",
      "distributionCertificateExpiresOn",
      "distributionCertificateSerial",
      "provisioningProfileExpiresOn",
      "provisioningProfileId",
      "responsible",
      "reviewedAt",
    ]) ||
    !validTimestamp(credentials?.reviewedAt) ||
    typeof credentials?.responsible !== "string" ||
    credentials.responsible.trim().length < 2 ||
    credentials.responsible.length > 100 ||
    credentials.responsible.includes("@") ||
    !/^[A-F0-9]{16,64}$/u.test(credentials?.distributionCertificateSerial ?? "") ||
    !validDate(credentials?.distributionCertificateExpiresOn) ||
    !/^[A-Z0-9]{10}$/u.test(credentials?.provisioningProfileId ?? "") ||
    !validDate(credentials?.provisioningProfileExpiresOn) ||
    !/^[A-Z0-9]{10}$/u.test(credentials?.apnsKeyId ?? "") ||
    !/^[A-Z0-9]{10}$/u.test(credentials?.ascApiKeyId ?? "")
  ) {
    failures.push("credential review metadata is incomplete or malformed");
  }

  if (!validTimestamp(record?.recordedAt)) {
    failures.push("recordedAt must be an ISO timestamp with an explicit time zone");
  } else if (
    validTimestamp(credentials?.reviewedAt) &&
    Date.parse(credentials.reviewedAt) > Date.parse(record.recordedAt)
  ) {
    failures.push("credential review cannot occur after the release record timestamp");
  }
  for (const expiry of [
    credentials?.distributionCertificateExpiresOn,
    credentials?.provisioningProfileExpiresOn,
  ]) {
    if (
      validDate(expiry) &&
      validTimestamp(record?.recordedAt) &&
      Date.parse(`${expiry}T23:59:59Z`) <= Date.parse(record.recordedAt)
    ) {
      failures.push("a release credential is expired at the record timestamp");
    }
  }

  validateReviewLifecycle(record?.appReview, record?.recordedAt, failures);
  validateScreenshotManifest(
    screenshotsManifest,
    candidate,
    record?.recordedAt,
    failures,
  );
  validateSmokeRecord(smokeTestSource, candidate, record?.recordedAt, failures);
  validateGuideline21Response(
    appReviewResponseSource,
    candidate,
    record?.recordedAt,
    {
      screenRecordingFilename: evidence?.screenRecordingFilename,
      screenRecordingSha256: evidence?.screenRecordingSha256,
    },
    failures,
  );
  return failures;
}
