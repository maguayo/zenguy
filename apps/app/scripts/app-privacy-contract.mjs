import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");

const expectedDataTypes = [
  [
    "Contact Info",
    "Name",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypeName",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "Contact Info",
    "Email Address",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypeEmailAddress",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "Contact Info",
    "Phone Number",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypePhoneNumber",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "User Content",
    "Photos or Videos",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypePhotosorVideos",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "User Content",
    "Other User Content",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypeOtherUserContent",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "Identifiers",
    "User ID",
    ["App Functionality", "Analytics"],
    "NSPrivacyCollectedDataTypeUserID",
    [
      "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      "NSPrivacyCollectedDataTypePurposeAnalytics",
    ],
  ],
  [
    "Identifiers",
    "Device ID",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypeDeviceID",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "Purchases",
    "Purchase History",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypePurchaseHistory",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
  [
    "Usage Data",
    "Product Interaction",
    ["App Functionality", "Analytics"],
    "NSPrivacyCollectedDataTypeProductInteraction",
    [
      "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      "NSPrivacyCollectedDataTypePurposeAnalytics",
    ],
  ],
  [
    "Usage Data",
    "Other Usage Data",
    ["App Functionality", "Analytics"],
    "NSPrivacyCollectedDataTypeOtherUsageData",
    [
      "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      "NSPrivacyCollectedDataTypePurposeAnalytics",
    ],
  ],
  [
    "Diagnostics",
    "Other Diagnostic Data",
    ["App Functionality"],
    "NSPrivacyCollectedDataTypeOtherDiagnosticData",
    ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  ],
].map(([category, dataType, purposes, manifestDataType, manifestPurposes]) => ({
  category,
  dataType,
  linkedToUser: true,
  usedForTracking: false,
  purposes,
  privacyManifest: {
    dataType: manifestDataType,
    purposes: manifestPurposes,
  },
}));

export const appPrivacyConfig = JSON.parse(
  readFileSync(join(appRoot, "app-privacy.config.json"), "utf8"),
);
export const appPrivacyInventory = readFileSync(
  join(repositoryRoot, "docs", "ios-app-privacy-inventory.md"),
  "utf8",
);

export const expectedPrivacyManifestCollectedData = Object.fromEntries(
  expectedDataTypes
    .map((entry) => [
      entry.privacyManifest.dataType,
      [...entry.privacyManifest.purposes].sort(),
    ])
    .sort(([left], [right]) => left.localeCompare(right)),
);

function portalRows(inventory) {
  const section =
    /## App Store Connect answers\n\n([\s\S]*?)\n\nDo \*\*not\*\* select/u.exec(
      inventory,
    )?.[1] ?? "";
  return [...section.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gmu)]
    .filter((match) => match[1] !== "App Privacy category" && match[1] !== "---")
    .map((match) => ({
      category: match[1],
      dataType: match[2],
      linkedToUser: true,
      usedForTracking: false,
      purposes: match[3].split("; "),
    }));
}

function portalShape(entries) {
  return entries.map(({ category, dataType, linkedToUser, usedForTracking, purposes }) => ({
    category,
    dataType,
    linkedToUser,
    usedForTracking,
    purposes,
  }));
}

export function validateAppPrivacyContract(
  config = appPrivacyConfig,
  inventory = appPrivacyInventory,
) {
  const failures = [];
  const apple =
    config !== null && typeof config === "object" && !Array.isArray(config)
      ? config.apple
      : undefined;
  const dataTypes = Array.isArray(apple?.dataTypes) ? apple.dataTypes : [];

  if (
    config?.configVersion !== 0 ||
    config?.lastReconciled !== "2026-09-01" ||
    JSON.stringify(Object.keys(config ?? {}).sort()) !==
      JSON.stringify(["apple", "configVersion", "lastReconciled"])
  ) {
    failures.push("config root/version/reconciliation date is not exact");
  }
  if (
    JSON.stringify(Object.keys(apple ?? {}).sort()) !==
      JSON.stringify([
        "collectsData",
        "dataTypes",
        "privacyChoicesUrl",
        "privacyPolicyUrl",
        "tracking",
      ]) ||
    apple?.collectsData !== true ||
    apple?.tracking !== false ||
    apple?.privacyPolicyUrl !== "https://zenguy.com/privacy/" ||
    apple?.privacyChoicesUrl !== "https://zenguy.com/privacy-choices/"
  ) {
    failures.push("Apple collection/tracking/URL answers are not exact");
  }
  if (JSON.stringify(dataTypes) !== JSON.stringify(expectedDataTypes)) {
    failures.push("the eleven portal answers or privacy-manifest mappings drifted");
  }

  const normalizedInventory = inventory.replace(/\s+/gu, " ").trim();
  if (
    !normalizedInventory.includes("Last reconciled: **1 September 2026**.") ||
    !normalizedInventory.includes(
      "Every row is **Linked to the User: Yes**, **Used for Tracking: No**.",
    ) ||
    !inventory.includes("- Privacy Policy: `https://zenguy.com/privacy/`") ||
    !inventory.includes(
      "- User Privacy Choices: `https://zenguy.com/privacy-choices/`",
    )
  ) {
    failures.push("inventory linkage/tracking/URL instructions drifted");
  }
  if (
    JSON.stringify(portalRows(inventory)) !==
    JSON.stringify(portalShape(expectedDataTypes))
  ) {
    failures.push("inventory App Store Connect table differs from structured answers");
  }

  return failures;
}
