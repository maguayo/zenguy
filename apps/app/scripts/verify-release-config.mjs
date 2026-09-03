import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appPrivacyConfig,
  expectedPrivacyManifestCollectedData,
  validateAppPrivacyContract,
} from "./app-privacy-contract.mjs";
import { validateExistingAccountOnlyContract } from "./existing-account-only-contract.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedDomain = "applinks:app.zenguy.com";
const expectedImage = "macos-tahoe-26.5-xcode-26.6";
const expectedProjectId = "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7";
const expectedAppId = "HT84Q65URB.com.zenguy.app";
const expectedRouterScheme = "zenguy-internal";
const expectedCertificateFingerprint =
  "88:2A:06:F4:85:BF:16:0F:3F:F2:63:E8:2E:26:8A:DC:B0:00:51:8D:40:99:0E:B2:D4:2F:22:47:A0:F8:5D:10";
const failures = [];

const expectedRequiredReasonApis = {
  NSPrivacyAccessedAPICategoryDiskSpace: ["85F4.1", "E174.1"],
  NSPrivacyAccessedAPICategoryFileTimestamp: ["0A2A.1", "3B52.1", "C617.1"],
  NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1"],
  NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"],
};

function fail(message) {
  failures.push(message);
}

for (const failure of validateAppPrivacyContract()) {
  fail(`app privacy: ${failure}`);
}

function normalizedRequiredReasonApis(entries) {
  return Object.fromEntries(
    (entries ?? [])
      .map((entry) => [
        entry.NSPrivacyAccessedAPIType,
        [...(entry.NSPrivacyAccessedAPITypeReasons ?? [])].sort(),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizedCollectedData(entries) {
  for (const entry of entries ?? []) {
    if (
      entry.NSPrivacyCollectedDataTypeLinked !== true ||
      entry.NSPrivacyCollectedDataTypeTracking !== false
    ) {
      fail(
        `${entry.NSPrivacyCollectedDataType}: collected data must remain linked and non-tracking`,
      );
    }
  }
  return Object.fromEntries(
    (entries ?? [])
      .map((entry) => [
        entry.NSPrivacyCollectedDataType,
        [...(entry.NSPrivacyCollectedDataTypePurposes ?? [])].sort(),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function resolvedConfig(profile) {
  const expo = join(appRoot, "node_modules", "expo", "bin", "cli");
  const result = spawnSync(process.execPath, [expo, "config", "--type", "introspect", "--json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_VARIANT: profile,
      EXPO_PUBLIC_API_ORIGIN:
        profile === "production"
          ? "https://api.zenguy.com"
          : "https://api-staging.zenguy.com",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Expo config failed for ${profile}: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function verifyNativeProfile(profile, expectedApns, localNetworking) {
  const config = resolvedConfig(profile);
  const ios = config._internal?.modResults?.ios;
  const info = ios?.infoPlist ?? {};
  const entitlements = ios?.entitlements ?? {};
  const expoPlist = ios?.expoPlist ?? {};

  if (Array.isArray(info.CFBundleURLTypes) && info.CFBundleURLTypes.length > 0) {
    fail(`${profile}: generated Info.plist still registers a custom URL scheme`);
  }
  if (config.scheme !== expectedRouterScheme) {
    fail(`${profile}: Expo Router logical scheme is missing or changed`);
  }
  if (
    JSON.stringify(entitlements["com.apple.developer.associated-domains"]) !==
    JSON.stringify([expectedDomain])
  ) {
    fail(`${profile}: generated associated-domains entitlement is not exact`);
  }
  if (entitlements["aps-environment"] !== expectedApns) {
    fail(`${profile}: aps-environment must be ${expectedApns}`);
  }
  if (info.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false) {
    fail(`${profile}: App Transport Security must forbid arbitrary loads`);
  }
  if (localNetworking) {
    if (info.NSAppTransportSecurity?.NSAllowsLocalNetworking !== true) {
      fail(`${profile}: local networking should be enabled only for the development profile`);
    }
  } else if (info.NSAppTransportSecurity?.NSAllowsLocalNetworking !== undefined) {
    fail(`${profile}: release-like profiles must not allow local networking`);
  }
  if (expoPlist.EXUpdatesRuntimeVersion !== config.version) {
    fail(`${profile}: EAS Update runtime must match the public app version`);
  }
  if (
    expoPlist.EXUpdatesCodeSigningMetadata?.alg !== "rsa-v1_5-sha256" ||
    expoPlist.EXUpdatesCodeSigningMetadata?.keyid !== "zenguy-2026-01"
  ) {
    fail(`${profile}: signed-update metadata is missing or changed`);
  }
  if (typeof expoPlist.EXUpdatesCodeSigningCertificate !== "string") {
    fail(`${profile}: the generated native app does not embed the update certificate`);
  }
  return config;
}

const production = verifyNativeProfile("production", "production", false);
verifyNativeProfile("preview", "development", false);
verifyNativeProfile("development", "development", true);

const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
if (production.version !== packageJson.version) {
  fail("app.config.ts version must exactly match apps/app/package.json");
}
if (production.ios?.bundleIdentifier !== "com.zenguy.app") {
  fail("production bundle identifier changed");
}
if (production.ios?.appleTeamId !== "HT84Q65URB") {
  fail("production Apple Team ID changed");
}
if (production.extra?.eas?.projectId !== expectedProjectId) {
  fail("production EAS project ID changed");
}
if (
  JSON.stringify(
    normalizedRequiredReasonApis(
      production.ios?.privacyManifests?.NSPrivacyAccessedAPITypes,
    ),
  ) !== JSON.stringify(expectedRequiredReasonApis)
) {
  fail("application privacy manifest must contain the exact required-reason API union");
}
if (
  production.ios?.privacyManifests?.NSPrivacyTracking !==
    appPrivacyConfig.apple.tracking ||
  JSON.stringify(production.ios?.privacyManifests?.NSPrivacyTrackingDomains) !==
    JSON.stringify([]) ||
  JSON.stringify(
    normalizedCollectedData(
      production.ios?.privacyManifests?.NSPrivacyCollectedDataTypes,
    ),
  ) !== JSON.stringify(expectedPrivacyManifestCollectedData)
) {
  fail(
    "application privacy manifest must match the exact eleven structured App Store answers",
  );
}

const eas = JSON.parse(readFileSync(join(appRoot, "eas.json"), "utf8"));
if (eas.cli?.version !== "23.2.0" || eas.cli?.requireCommit !== true) {
  fail("EAS CLI must be exact and builds must require a clean commit");
}
for (const profile of ["development", "preview", "production"]) {
  if (eas.build?.[profile]?.ios?.image !== expectedImage) {
    fail(`${profile}: EAS iOS image must be pinned to ${expectedImage}`);
  }
}
if (
  eas.build?.production?.channel !== "production" ||
  eas.build?.production?.environment !== "production" ||
  eas.build?.production?.env?.APP_VARIANT !== "production" ||
  eas.build?.production?.env?.EXPO_PUBLIC_API_ORIGIN !== "https://api.zenguy.com"
) {
  fail("production build must use only the production channel, environment, variant and API origin");
}
for (const [profile, build] of Object.entries(eas.build ?? {})) {
  if (build.env?.APP_VARIANT !== profile) {
    fail(`${profile}: APP_VARIANT must exactly match the build profile`);
  }
  for (const [name, value] of Object.entries(build.env ?? {})) {
    if (
      (name !== "APP_VARIANT" && !name.startsWith("EXPO_PUBLIC_")) ||
      typeof value !== "string"
    ) {
      fail(`${profile}: build profile contains a non-public inline environment value`);
    }
  }
}
if (
  eas.submit?.production?.ios?.ascAppId !== "6804201911" ||
  Object.hasOwn(eas.submit.production.ios, "metadataPath") ||
  JSON.stringify(eas.submit?.["app-review-metadata"]?.ios) !==
    JSON.stringify({
      ascAppId: "6804201911",
      metadataPath: "./store.review.config.cjs",
    })
) {
  fail(
    "EAS submit must keep binary submission separate from the dynamic App Review metadata profile",
  );
}

const certificatePath = join(appRoot, "certs", "updates-certificate.pem");
const certificatePem = readFileSync(certificatePath, "utf8");
if (/PRIVATE KEY/u.test(certificatePem)) fail("tracked update certificate contains a private key");
const certificate = new X509Certificate(certificatePem);
if (certificate.fingerprint256 !== expectedCertificateFingerprint) {
  fail("update certificate fingerprint changed without an explicit verifier rotation");
}
if (certificate.publicKey.asymmetricKeyType !== "rsa") {
  fail("update certificate must use RSA");
}
if ((certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
  fail("update certificate RSA key must be at least 2048 bits");
}
const now = Date.now();
if (Date.parse(certificate.validFrom) > now) fail("update certificate is not valid yet");
if (Date.parse(certificate.validTo) < now + 365 * 24 * 60 * 60 * 1_000) {
  fail("update certificate expires in less than one year");
}
const embeddedCertificate =
  production._internal?.modResults?.ios?.expoPlist?.EXUpdatesCodeSigningCertificate;
if (
  typeof embeddedCertificate === "string" &&
  new X509Certificate(embeddedCertificate).fingerprint256 !== certificate.fingerprint256
) {
  fail("generated native app embeds a different update certificate");
}

const privateKeyPath = join(appRoot, "credentials", "updates-private-key.pem");
if (existsSync(privateKeyPath)) {
  const stat = lstatSync(privateKeyPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("local update key must be a regular file");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    fail("local update key has the wrong owner");
  }
  if ((stat.mode & 0o077) !== 0) fail("local update key must use mode 0600");
  if (stat.isFile() && !stat.isSymbolicLink()) {
    const privateBytes = readFileSync(privateKeyPath);
    try {
      const privatePublic = createPublicKey(createPrivateKey(privateBytes)).export({
        format: "der",
        type: "spki",
      });
      const certificatePublic = certificate.publicKey.export({
        format: "der",
        type: "spki",
      });
      if (!privatePublic.equals(certificatePublic)) {
        fail("local update private key does not match the versioned certificate");
      }
    } catch {
      fail("local update private key is unreadable or invalid");
    } finally {
      privateBytes.fill(0);
    }
  }
}

const aasaPath = join(
  appRoot,
  "..",
  "frontend",
  "public",
  ".well-known",
  "apple-app-site-association",
);
const aasaText = readFileSync(aasaPath, "utf8");
if (Buffer.byteLength(aasaText) >= 128 * 1024) fail("AASA exceeds Apple's 128 KiB limit");
const aasa = JSON.parse(aasaText);
const details = aasa.applinks?.details ?? [];
const modern = details.find((detail) => detail.appIDs?.includes(expectedAppId));
const legacy = details.find((detail) => detail.appID === expectedAppId);
const expectedPaths = [
  "/reset-password",
  "/invitations/*",
  "/w/*",
];
if (
  JSON.stringify(modern?.components?.map((component) => component["/"])) !==
  JSON.stringify(expectedPaths)
) {
  fail("AASA modern components do not exactly match the approved routes");
}
if (JSON.stringify(legacy?.paths) !== JSON.stringify(expectedPaths)) {
  fail("AASA legacy paths do not exactly match the approved routes");
}

// App Review 3.1.3(f): iOS is deliberately an existing-account-only
// companion. Reject routes, modules, positive acquisition copy, API calls and
// outbound purchase URLs across the complete production mobile source tree.
for (const failure of validateExistingAccountOnlyContract(appRoot)) {
  fail(`existing-account-only: ${failure}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "iOS release config verified (existing-account-only source, profiles, entitlements, App Privacy, OTA certificate, AASA).",
  );
}
