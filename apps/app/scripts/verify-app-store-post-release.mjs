#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { validatePostReleaseMonitoringRecord } from "./post-release-monitoring-contract.mjs";

const maxEvidenceBytes = 1024 * 1024;

function usage() {
  return (
    "usage: verify-app-store-post-release.mjs <post-release-record.json> " +
    "--release-record <released-release-record.json>"
  );
}

function regularFile(argument, label) {
  if (typeof argument !== "string" || argument.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const path = resolve(argument);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`${label} does not exist`);
  }
  if (!stats.isFile() || stats.size === 0 || stats.size > maxEvidenceBytes) {
    throw new Error(`${label} must be a non-empty regular file under 1 MiB`);
  }
  return path;
}

function parseArguments(argv) {
  if (argv.length !== 3 || argv[1] !== "--release-record") {
    throw new Error(usage());
  }
  return {
    monitoring: regularFile(argv[0], "post-release monitoring record"),
    release: regularFile(argv[2], "RELEASED release record"),
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

try {
  const paths = parseArguments(process.argv.slice(2));
  const releaseBytes = readFileSync(paths.release);
  const releaseRecordSha256 = createHash("sha256")
    .update(releaseBytes)
    .digest("hex");
  const releaseRecord = readJson(paths.release, "RELEASED release record");
  const monitoringRecord = readJson(
    paths.monitoring,
    "post-release monitoring record",
  );
  const failures = validatePostReleaseMonitoringRecord(monitoringRecord, {
    releaseRecord,
    releaseRecordSha256,
  });
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Post-release monitoring verified for Zenguy ${monitoringRecord.candidate.version} ` +
        `(${monitoringRecord.candidate.build}) through H+48.`,
    );
  }
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : "verification failed"}`);
  process.exitCode = 2;
}
