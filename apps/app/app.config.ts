import type { ConfigContext, ExpoConfig } from "expo/config";

// The app ships no secrets: the only build-time setting is the API origin,
// provided through EXPO_PUBLIC_API_ORIGIN (see eas.json and README.md).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Zenguy",
  slug: "zenguy",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "zenguy",
  platforms: ["ios"],
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "com.zenguy.app",
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
        NSAllowsLocalNetworking: true,
      },
      UIBackgroundModes: [],
    },
    // Universal links (https://app.zenguy.com/...) need an AASA file served by
    // the web app before this can be enabled. The custom scheme works today.
    // associatedDomains: ["applinks:app.zenguy.com"],
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
        imageWidth: 160,
        resizeMode: "contain",
        backgroundColor: "#09090b",
      },
    ],
    "expo-font",
    [
      "expo-notifications",
      {
        // aps-environment: production for store builds, development otherwise.
        mode: process.env.EAS_BUILD_PROFILE === "production" ? "production" : "development",
      },
    ],
  ],
  experiments: {
    // Typed routes reject string-built hrefs and only exist after `expo start`,
    // which makes typecheck non-deterministic; routes are covered by tests instead.
    typedRoutes: false,
  },
  extra: {
    router: {},
    eas: {
      // Set after `eas init` links the project to an Expo account.
      // projectId: "",
    },
  },
});
