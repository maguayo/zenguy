#!/usr/bin/env node

import { validateAppAgeRatingContract } from "./app-age-rating-contract.mjs";

const failures = validateAppAgeRatingContract();
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "App age-rating contract verified (24 current answers; calculated 4+, Terms override and display rating 18+).",
  );
}
