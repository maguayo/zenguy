#!/usr/bin/env node

import { validateAppPrivacyContract } from "./app-privacy-contract.mjs";

const failures = validateAppPrivacyContract();
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "App Privacy contract verified (11 linked, non-tracking data types; inventory and native mappings aligned).",
  );
}
