import assert from "node:assert/strict";
import test from "node:test";

import {
  appPrivacyConfig,
  appPrivacyInventory,
  expectedPrivacyManifestCollectedData,
  validateAppPrivacyContract,
} from "./app-privacy-contract.mjs";

test("reconciles the eleven App Store answers, inventory and privacy manifest", () => {
  assert.deepEqual(validateAppPrivacyContract(), []);
  assert.equal(appPrivacyConfig.apple.dataTypes.length, 11);
  assert.equal(Object.keys(expectedPrivacyManifestCollectedData).length, 11);
});

test("rejects tracking or collected-data drift in the structured source", () => {
  const changed = structuredClone(appPrivacyConfig);
  changed.apple.tracking = true;
  changed.apple.dataTypes.pop();

  assert.deepEqual(validateAppPrivacyContract(changed, appPrivacyInventory), [
    "Apple collection/tracking/URL answers are not exact",
    "the eleven portal answers or privacy-manifest mappings drifted",
  ]);
});

test("rejects drift between the structured answers and the human portal table", () => {
  const changedInventory = appPrivacyInventory.replace(
    "| Contact Info | Phone Number | App Functionality |",
    "| Contact Info | Phone Number | Analytics |",
  );

  assert.deepEqual(validateAppPrivacyContract(appPrivacyConfig, changedInventory), [
    "inventory App Store Connect table differs from structured answers",
  ]);
});
