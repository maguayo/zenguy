import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedDomain = "applinks:app.zenguy.com";
const expectedImage = "macos-tahoe-26.5-xcode-26.6";
const expectedProjectId = "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7";
const expectedAppId = "HT84Q65URB.com.zenguy.app";
const expectedCertificateFingerprint =
  "88:2A:06:F4:85:BF:16:0F:3F:F2:63:E8:2E:26:8A:DC:B0:00:51:8D:40:99:0E:B2:D4:2F:22:47:A0:F8:5D:10";
const failures = [];

function fail(message) {
  failures.push(message);
}

function resolvedConfig(profile) {
  const expo = join(appRoot, "node_modules", ".bin", "expo");
  const result = spawnSync(expo, ["config", "--type", "introspect", "--json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      EAS_BUILD_PROFILE: profile,
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
  if (expoPlist.EXUpdatesRuntimeVersion !== "file:fingerprint") {
    fail(`${profile}: EAS Update runtime must resolve from a native fingerprint`);
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

const eas = JSON.parse(readFileSync(join(appRoot, "eas.json"), "utf8"));
if (eas.cli?.version !== "22.0.0" || eas.cli?.requireCommit !== true) {
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
  eas.build?.production?.env?.EXPO_PUBLIC_API_ORIGIN !== "https://api.zenguy.com"
) {
  fail("production build must use only the production channel, environment and API origin");
}
for (const [profile, build] of Object.entries(eas.build ?? {})) {
  for (const [name, value] of Object.entries(build.env ?? {})) {
    if (!name.startsWith("EXPO_PUBLIC_") || typeof value !== "string") {
      fail(`${profile}: build profile contains a non-public inline environment value`);
    }
  }
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
  "/verify-email",
  "/reset-password",
  "/invitations/*",
  "/grants/*",
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("iOS release config verified (profiles, entitlements, OTA certificate, AASA).");
}
