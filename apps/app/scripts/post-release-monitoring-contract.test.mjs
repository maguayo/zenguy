import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePostReleaseMonitoringRecord } from "./post-release-monitoring-contract.mjs";

const buildId = "11111111-1111-4111-8111-111111111111";
const submissionId = "22222222-2222-4222-8222-222222222222";
const buildUrl = `https://expo.dev/accounts/maguayo/projects/zenguy/builds/${buildId}`;
const submissionUrl = `https://expo.dev/accounts/maguayo/projects/zenguy/submissions/${submissionId}`;
const storeUrl = "https://apps.apple.com/app/id6804201911";
const commit = "a".repeat(40);
const releaseHash = "f".repeat(64);
const verifierPath = fileURLToPath(
  new URL("./verify-app-store-post-release.mjs", import.meta.url),
);

function releasedRecord() {
  return {
    schemaVersion: 4,
    app: { bundleIdentifier: "com.zenguy.app", ascAppId: "6804201911" },
    candidate: {
      version: "0.2.2",
      build: "5",
      commit,
      easBuildId: buildId,
      easBuildUrl: buildUrl,
      easSubmissionId: submissionId,
      easSubmissionUrl: submissionUrl,
    },
    credentials: {
      responsible: "Release owner",
      distributionCertificateExpiresOn: "2027-07-25",
      provisioningProfileExpiresOn: "2027-07-25",
    },
    appReview: {
      stage: "RELEASED",
      status: "READY_FOR_DISTRIBUTION",
      releasedAt: "2026-09-03T12:00:00+02:00",
      appStoreUrl: storeUrl,
    },
    recordedAt: "2026-09-03T12:30:00+02:00",
  };
}

function healthySignals(label) {
  return {
    api: { status: "HEALTHY", evidence: `${label}: API health and version passed.` },
    appReviewMessages: {
      status: "CLEAR",
      evidence: `${label}: App Store Connect had no action-required message.`,
    },
    crashes: {
      status: "HEALTHY",
      evidence: `${label}: App Store Connect crash signal reviewed.`,
    },
    login: { status: "HEALTHY", evidence: `${label}: existing-account login passed.` },
    notifications: {
      status: "HEALTHY",
      evidence: `${label}: production notification probe passed.`,
    },
    runner: { status: "HEALTHY", evidence: `${label}: controlled runner probe passed.` },
    support: { status: "HEALTHY", evidence: `${label}: support queue reviewed.` },
  };
}

function validMonitoringRecord() {
  return {
    schemaVersion: 1,
    releaseRecordSha256: releaseHash,
    candidate: {
      version: "0.2.2",
      build: "5",
      commit,
      easBuildId: buildId,
      easBuildUrl: buildUrl,
      easSubmissionId: submissionId,
      easSubmissionUrl: submissionUrl,
      appStoreUrl: storeUrl,
      releasedAt: "2026-09-03T12:00:00+02:00",
    },
    owners: {
      operations: "Release owner",
      support: "Support owner",
      credentials: "Release owner",
    },
    credentialRenewal: {
      distributionCertificateExpiresOn: "2027-07-25",
      provisioningProfileExpiresOn: "2027-07-25",
      nextReviewOn: "2027-06-01",
    },
    checkpoints: [
      {
        phase: "RELEASE",
        observedAt: "2026-09-03T12:30:00+02:00",
        signals: healthySignals("Release"),
      },
      {
        phase: "H_PLUS_24",
        observedAt: "2026-09-04T12:00:00+02:00",
        signals: healthySignals("H+24"),
      },
      {
        phase: "H_PLUS_48",
        observedAt: "2026-09-05T12:00:00+02:00",
        signals: healthySignals("H+48"),
      },
    ],
    incidents: [],
    completedAt: "2026-09-05T12:30:00+02:00",
  };
}

function evidence() {
  return { releaseRecord: releasedRecord(), releaseRecordSha256: releaseHash };
}

test("accepts a hash-linked release monitored through H+48", () => {
  assert.deepEqual(
    validatePostReleaseMonitoringRecord(validMonitoringRecord(), evidence()),
    [],
  );
});

test("rejects a mismatched candidate and a final checkpoint before 48 hours", () => {
  const record = validMonitoringRecord();
  record.candidate.easSubmissionUrl = buildUrl;
  record.checkpoints[2].observedAt = "2026-09-05T10:00:00+02:00";
  record.completedAt = "2026-09-05T10:30:00+02:00";

  const failures = validatePostReleaseMonitoringRecord(record, evidence());
  assert.equal(
    failures.includes("post-release candidate does not match the supplied RELEASED record"),
    true,
  );
  assert.equal(
    failures.includes("post-release checkpoint H_PLUS_48 falls outside its release window"),
    true,
  );
});

test("rejects an issue that has no resolved incident evidence", () => {
  const record = validMonitoringRecord();
  record.checkpoints[1].signals.api = {
    status: "DEGRADED",
    evidence: "H+24: elevated API errors were observed.",
  };

  const failures = validatePostReleaseMonitoringRecord(record, evidence());
  assert.equal(
    failures.includes("post-release api issue is not covered by a resolved incident"),
    true,
  );
});

test("accepts a documented issue resolved before the healthy H+48 checkpoint", () => {
  const record = validMonitoringRecord();
  record.checkpoints[1].signals.api = {
    status: "DEGRADED",
    evidence: "H+24: elevated API errors matched the incident timeline.",
  };
  record.incidents = [
    {
      reference: "INC-2026-0904",
      openedAt: "2026-09-04T11:30:00+02:00",
      resolvedAt: "2026-09-04T12:30:00+02:00",
      summary: "Transient API errors were mitigated and the probe recovered.",
      affectedSignals: ["api"],
    },
  ];

  assert.deepEqual(validatePostReleaseMonitoringRecord(record, evidence()), []);
});

test("verifies the two hash-linked JSON files through the public CLI", () => {
  const directory = mkdtempSync(join(tmpdir(), "zenguy-post-release-"));
  try {
    const releasePath = join(directory, "release-record-released.json");
    const monitoringPath = join(directory, "post-release-monitoring.json");
    const releaseSource = `${JSON.stringify(releasedRecord(), null, 2)}\n`;
    const monitoring = validMonitoringRecord();
    monitoring.releaseRecordSha256 = createHash("sha256")
      .update(releaseSource)
      .digest("hex");
    writeFileSync(releasePath, releaseSource, { flag: "wx" });
    writeFileSync(monitoringPath, `${JSON.stringify(monitoring, null, 2)}\n`, {
      flag: "wx",
    });

    const result = spawnSync(
      process.execPath,
      [verifierPath, monitoringPath, "--release-record", releasePath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /through H\+48/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
