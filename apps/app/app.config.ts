import type { ConfigContext, ExpoConfig } from "expo/config";

const isDevelopmentProfile = process.env.EAS_BUILD_PROFILE === "development";
const isProductionProfile = process.env.EAS_BUILD_PROFILE === "production";

// The app ships no secrets: the only build-time setting is the API origin,
// provided through EXPO_PUBLIC_API_ORIGIN (see eas.json and README.md).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Zenguy",
  slug: "zenguy",
  // EAS project "zenguy" in the maguayo Expo account (eas.json, EAS Update).
  owner: "maguayo",
  version: "0.2.2",
  // Native inputs produce a distinct runtime automatically. This prevents an
  // OTA from crossing an entitlement, module or config-plugin boundary.
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: "https://u.expo.dev/dbac86d4-6e5f-4cb1-b465-4182ccb5cac7",
    codeSigningCertificate: "./certs/updates-certificate.pem",
    codeSigningMetadata: {
      alg: "rsa-v1_5-sha256",
      keyid: "zenguy-2026-01",
    },
    // Check on launch; a pending update is applied on the next cold start.
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
  orientation: "portrait",
  platforms: ["ios"],
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.zenguy.app",
    // Apple Developer organisation "Niesayo Group SL" (Team ID from
    // developer.apple.com → Membership details). Signing is managed by EAS.
    appleTeamId: "HT84Q65URB",
    supportsTablet: false,
    buildNumber: "1",
    infoPlist: {
      // Only standard TLS is used; this avoids the export-compliance prompt
      // on every TestFlight upload.
      ITSAppUsesNonExemptEncryption: false,
      NSFaceIDUsageDescription:
        "Zenguy uses Face ID to unlock the app when App Lock is enabled.",
      // App Transport Security stays at its secure defaults: no cleartext
      // exceptions. NSAllowsLocalNetworking only permits the local Wrangler
      // API during development (http://127.0.0.1).
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        ...(isDevelopmentProfile ? { NSAllowsLocalNetworking: true } : {}),
      },
      UIBackgroundModes: [],
    },
    // The matching AASA file is versioned under apps/frontend/public/.well-known.
    associatedDomains: ["applinks:app.zenguy.com"],
    // expo-notifications can be auto-applied before its configured plugin and
    // otherwise leaves the default development entitlement in store builds.
    // Set the entitlement explicitly from the EAS profile.
    entitlements: {
      "aps-environment": isProductionProfile ? "production" : "development",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "Zenguy uses Face ID to unlock the app when App Lock is enabled.",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#F2EEE6",
      },
    ],
    [
      // Geist (text) and Geist Mono (data) are embedded natively so every
      // face is available at first paint; see src/theme/index.ts → fonts.
      "expo-font",
      {
        fonts: [
          "./assets/fonts/Geist-Regular.ttf",
          "./assets/fonts/Geist-Medium.ttf",
          "./assets/fonts/Geist-SemiBold.ttf",
          "./assets/fonts/Geist-Bold.ttf",
          "./assets/fonts/GeistMono-Regular.ttf",
          "./assets/fonts/GeistMono-Medium.ttf",
        ],
      },
    ],
    [
      "expo-notifications",
      {
        // aps-environment: production for store builds, development otherwise.
        mode: process.env.EAS_BUILD_PROFILE === "production" ? "production" : "development",
      },
    ],
    // Must remain last: Expo's default iOS scheme plugin otherwise adds the
    // bundle identifier as a claimable custom URL scheme.
    "./plugins/with-universal-links-only",
  ],
  experiments: {
    // Typed routes reject string-built hrefs and only exist after `expo start`,
    // which makes typecheck non-deterministic; routes are covered by tests instead.
    typedRoutes: false,
  },
  extra: {
    router: {},
    eas: {
      projectId: "dbac86d4-6e5f-4cb1-b465-4182ccb5cac7",
    },
  },
});
