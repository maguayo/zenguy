#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectedPrivacyManifestCollectedData as expectedCollectedData,
  validateAppPrivacyContract,
} from "./app-privacy-contract.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedBundleId = "com.zenguy.app";
const expectedTeamId = "HT84Q65URB";
const expectedProjectId = "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7";
const expectedRequiredReasonApis = {
  NSPrivacyAccessedAPICategoryDiskSpace: ["85F4.1", "E174.1"],
  NSPrivacyAccessedAPICategoryFileTimestamp: ["0A2A.1", "3B52.1", "C617.1"],
  NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1"],
  NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
};
const forbiddenVisibleCopy = [
  "Sign up",
  "Create account",
  "Create workspace",
  "Set up subscription",
  "Manage billing",
  "Checkout",
  "Pricing",
];

function usage(exitCode = 2) {
  console.error(
    "usage: verify-ios-archive.mjs <archive.xcarchive> [--minimum-build <number>] [--allow-unsigned]",
  );
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const archiveArgument = args.shift();
if (archiveArgument === undefined || archiveArgument.startsWith("--")) usage();
let minimumBuild = 1;
let allowUnsigned = false;
while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--allow-unsigned") {
    allowUnsigned = true;
  } else if (flag === "--minimum-build") {
    const value = args.shift();
    if (value === undefined || !/^[1-9]\d*$/u.test(value)) usage();
    minimumBuild = Number(value);
  } else {
    usage();
  }
}

const failures = [];
function fail(message) {
  failures.push(message);
}

for (const failure of validateAppPrivacyContract()) {
  fail(`app privacy: ${failure}`);
}

function plist(path, extractKey) {
  const commandArgs =
    extractKey === undefined
      ? ["-convert", "json", "-o", "-", path]
      : ["-extract", extractKey, "json", "-o", "-", path];
  const result = spawnSync("/usr/bin/plutil", commandArgs, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`plutil failed for ${path}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function sortedObject(entries) {
  return Object.fromEntries(
    entries.sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizedRequiredReasonApis(entries) {
  return sortedObject(
    (entries ?? []).map((entry) => [
      entry.NSPrivacyAccessedAPIType,
      [...(entry.NSPrivacyAccessedAPITypeReasons ?? [])].sort(),
    ]),
  );
}

function normalizedCollectedData(entries) {
  for (const entry of entries ?? []) {
    if (
      entry.NSPrivacyCollectedDataTypeLinked !== true ||
      entry.NSPrivacyCollectedDataTypeTracking !== false
    ) {
      fail(`${entry.NSPrivacyCollectedDataType}: collected data must be linked and non-tracking`);
    }
  }
  return sortedObject(
    (entries ?? []).map((entry) => [
      entry.NSPrivacyCollectedDataType,
      [...(entry.NSPrivacyCollectedDataTypePurposes ?? [])].sort(),
    ]),
  );
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function filesNamed(root, name) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...filesNamed(path, name));
    else if (entry.isFile() && entry.name === name) found.push(path);
  }
  return found;
}

const archivePath = resolve(archiveArgument);
if (!existsSync(archivePath) || !lstatSync(archivePath).isDirectory()) {
  throw new Error(`archive does not exist or is not a directory: ${archivePath}`);
}
const archiveProperties = plist(join(archivePath, "Info.plist"), "ApplicationProperties");
const applicationPath = archiveProperties.ApplicationPath;
if (
  typeof applicationPath !== "string" ||
  isAbsolute(applicationPath) ||
  applicationPath.split("/").includes("..")
) {
  throw new Error("archive contains an unsafe ApplicationPath");
}
const appPath = realpathSync(join(archivePath, "Products", applicationPath));
if (relative(realpathSync(archivePath), appPath).startsWith("..")) {
  throw new Error("archive application resolves outside the archive");
}

const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const info = plist(join(appPath, "Info.plist"));
if (archiveProperties.CFBundleIdentifier !== expectedBundleId || info.CFBundleIdentifier !== expectedBundleId) {
  fail(`bundle identifier must be ${expectedBundleId}`);
}
if (
  archiveProperties.CFBundleShortVersionString !== packageJson.version ||
  info.CFBundleShortVersionString !== packageJson.version
) {
  fail(`archive version must match package version ${packageJson.version}`);
}
const buildNumber = Number(info.CFBundleVersion);
if (!Number.isSafeInteger(buildNumber) || buildNumber < minimumBuild) {
  fail(`archive build number must be an integer >= ${minimumBuild}`);
}
if (!same(archiveProperties.Architectures, ["arm64"])) fail("archive must contain only arm64");
if (!same(info.CFBundleSupportedPlatforms, ["iPhoneOS"])) fail("archive must target iPhoneOS");
if (!same(info.UIDeviceFamily, [1])) fail("archive must be iPhone-only");
if (info.MinimumOSVersion !== "16.4") fail("minimum iOS version must remain 16.4");
if (info.ITSAppUsesNonExemptEncryption !== false) fail("export-compliance declaration changed");
if (Object.hasOwn(info, "CFBundleURLTypes")) fail("archive registers a custom URL scheme");
if (info.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false) {
  fail("archive must forbid arbitrary App Transport Security loads");
}
if (Object.hasOwn(info.NSAppTransportSecurity ?? {}, "NSAllowsLocalNetworking")) {
  fail("archive must not allow local networking");
}
if (!same(info.UIBackgroundModes, [])) fail("archive contains unexpected background modes");

const expo = plist(join(appPath, "Expo.plist"));
if (expo.EXUpdatesRuntimeVersion !== packageJson.version) {
  fail("runtime version must match the public app version");
}
if (expo.EXUpdatesURL !== `https://u.expo.dev/${expectedProjectId}`) fail("EAS Update project changed");
if (
  expo.EXUpdatesCodeSigningMetadata?.alg !== "rsa-v1_5-sha256" ||
  expo.EXUpdatesCodeSigningMetadata?.keyid !== "zenguy-2026-01" ||
  typeof expo.EXUpdatesCodeSigningCertificate !== "string"
) {
  fail("signed EAS Update configuration is missing or changed");
}
const appPrivacyPath = join(appPath, "PrivacyInfo.xcprivacy");
const appPrivacy = plist(appPrivacyPath);
if (appPrivacy.NSPrivacyTracking !== false || !same(appPrivacy.NSPrivacyTrackingDomains, [])) {
  fail("application privacy manifest enables tracking or tracking domains");
}
if (
  !same(
    normalizedRequiredReasonApis(appPrivacy.NSPrivacyAccessedAPITypes),
    expectedRequiredReasonApis,
  )
) {
  fail("application privacy manifest does not contain the exact required-reason API union");
}
if (
  !same(
    normalizedCollectedData(appPrivacy.NSPrivacyCollectedDataTypes),
    expectedCollectedData,
  )
) {
  fail("application privacy manifest does not contain the exact eleven declared data types");
}

const privacyManifests = filesNamed(appPath, "PrivacyInfo.xcprivacy");
if (privacyManifests.length < 10) fail("archive contains too few SDK privacy manifests");
const aggregateApis = new Map();
for (const manifestPath of privacyManifests) {
  const manifest = plist(manifestPath);
  if (manifest.NSPrivacyTracking !== false) {
    fail(`${relative(appPath, manifestPath)} does not explicitly disable tracking`);
  }
  if ((manifest.NSPrivacyTrackingDomains ?? []).length > 0) {
    fail(`${relative(appPath, manifestPath)} declares a tracking domain`);
  }
  if (manifestPath !== appPrivacyPath && (manifest.NSPrivacyCollectedDataTypes ?? []).length > 0) {
    fail(`${relative(appPath, manifestPath)} adds undeclared collected data`);
  }
  for (const [api, reasons] of Object.entries(
    normalizedRequiredReasonApis(manifest.NSPrivacyAccessedAPITypes),
  )) {
    const current = aggregateApis.get(api) ?? new Set();
    for (const reason of reasons) current.add(reason);
    aggregateApis.set(api, current);
  }
}
const normalizedAggregateApis = sortedObject(
  [...aggregateApis].map(([api, reasons]) => [api, [...reasons].sort()]),
);
if (!same(normalizedAggregateApis, expectedRequiredReasonApis)) {
  fail("aggregate SDK privacy reasons differ from the reviewed application union");
}

const bundle = readFileSync(join(appPath, "main.jsbundle"));
for (const phrase of forbiddenVisibleCopy) {
  if (bundle.includes(Buffer.from(phrase))) fail(`release bundle contains forbidden visible copy: ${phrase}`);
}

const signed =
  typeof archiveProperties.SigningIdentity === "string" &&
  archiveProperties.SigningIdentity.length > 0;
if (!signed && !allowUnsigned) {
  fail("archive is unsigned; use --allow-unsigned only for a local preflight");
} else if (signed) {
  if (archiveProperties.Team !== expectedTeamId) fail(`signed archive team must be ${expectedTeamId}`);
  const verification = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (verification.status !== 0) fail(`code signature verification failed: ${verification.stderr.trim()}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  const mode = signed ? `signed for team ${archiveProperties.Team}` : "unsigned local preflight";
  console.log(
    `iOS archive verified: ${expectedBundleId} ${packageJson.version} (${buildNumber}), runtime ${expo.EXUpdatesRuntimeVersion}, ${privacyManifests.length} privacy manifests, ${mode}.`,
  );
}
