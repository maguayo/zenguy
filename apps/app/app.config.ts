import type { ConfigContext, ExpoConfig } from "expo/config";

import appPrivacyConfig from "./app-privacy.config.json";

type PrivacyManifestConfig = NonNullable<
  NonNullable<ExpoConfig["ios"]>["privacyManifests"]
>;

const privacyCollectedDataTypes: PrivacyManifestConfig["NSPrivacyCollectedDataTypes"] =
  appPrivacyConfig.apple.dataTypes.map((entry) => ({
    NSPrivacyCollectedDataType: entry.privacyManifest.dataType,
    NSPrivacyCollectedDataTypeLinked: entry.linkedToUser,
    NSPrivacyCollectedDataTypeTracking: entry.usedForTracking,
    NSPrivacyCollectedDataTypePurposes: entry.privacyManifest.purposes,
  }));

const isDevelopmentProfile = process.env.EAS_BUILD_PROFILE === "development";
const isProductionProfile = process.env.EAS_BUILD_PROFILE === "production";
const internalRouterScheme = "zenguy-internal";

// The app ships no secrets: the only build-time setting is the API origin,
// provided through EXPO_PUBLIC_API_ORIGIN (see eas.json and README.md).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Zenguy",
  slug: "zenguy",
  // EAS project "zenguy" in the maguayo Expo account (eas.json, EAS Update).
  owner: "maguayo",
  version: "0.2.2",
  // Expo Router requires a logical scheme to resolve its root URL in a
  // standalone release. The final config plugin removes the corresponding
  // CFBundleURLTypes entry, so other iOS apps cannot invoke this scheme;
  // verified HTTPS Universal Links remain the only inbound link mechanism.
  scheme: internalRouterScheme,
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
    // Collected-data rows derive from app-privacy.config.json. The release
    // contract reconciles that structured source with the human inventory and
    // App Store Connect answers. Zenguy does not track users or use data for
    // advertising; all collection is linked to the signed-in account.
    privacyManifests: {
      NSPrivacyTracking: appPrivacyConfig.apple.tracking,
      NSPrivacyTrackingDomains: [],
      // Duplicate the complete required-reason API union in the application
      // manifest. Apple does not reliably aggregate every static CocoaPods
      // manifest, and ExpoFileSystem's generated resource bundle can be empty
      // when its prebuilt XCFramework is selected. Keep these reasons aligned
      // with the manifests shipped by Expo and React Native.
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["0A2A.1", "3B52.1", "C617.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["85F4.1", "E174.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
      NSPrivacyCollectedDataTypes: privacyCollectedDataTypes,
    },
  },
  plugins: [
    "expo-router",
    "expo-image",
    "expo-secure-store",
    "expo-sharing",
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
    // Must remain last: keep the logical Router scheme out of Info.plist so it
    // cannot become a claimable iOS URL scheme.
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
