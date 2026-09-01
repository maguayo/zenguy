import assert from "node:assert/strict";
import test from "node:test";

import {
  appAgeRatingConfig,
  appStoreMetadata,
  expectedAppAgeRatingAnswers,
  mobileTermsSource,
  validateAppAgeRatingContract,
  websiteTermsSource,
} from "./app-age-rating-contract.mjs";

test("reconciles all 24 current answers and the Terms-driven 18+ override", () => {
  assert.deepEqual(validateAppAgeRatingContract(), []);
  assert.equal(expectedAppAgeRatingAnswers.length, 24);
  assert.equal(appAgeRatingConfig.apple.calculatedGlobalRating, "4+");
  assert.equal(appAgeRatingConfig.apple.displayGlobalRating, "18+");
});

test("rejects answer or 18+ override drift in the structured source", () => {
  const changed = structuredClone(appAgeRatingConfig);
  changed.apple.answers[3].answer = "YES";
  changed.apple.overrideToHigherAgeRating = null;

  assert.deepEqual(
    validateAppAgeRatingContract(
      changed,
      appStoreMetadata,
      mobileTermsSource,
      websiteTermsSource,
    ),
    [
      "the 24 current App Store Connect answers drifted",
      "the Terms-driven 18+ override contract drifted",
    ],
  );
});

test("rejects drift between the structured answers and the portal table", () => {
  const changedMetadata = appStoreMetadata.replace(
    "| Capabilities | User-Generated Content | No |",
    "| Capabilities | User-Generated Content | Yes |",
  );

  assert.deepEqual(
    validateAppAgeRatingContract(
      appAgeRatingConfig,
      changedMetadata,
      mobileTermsSource,
      websiteTermsSource,
    ),
    ["metadata age-rating table differs from structured answers"],
  );
});

test("rejects an 18+ override that is no longer supported by both Terms", () => {
  const changedMobileTerms = mobileTermsSource.replace(
    "You must be 18 or older",
    "You must follow the account requirements",
  );
  const changedWebsiteTerms = websiteTermsSource.replace(
    "You must be at least 18",
    "You must follow the account requirements",
  );

  assert.deepEqual(
    validateAppAgeRatingContract(
      appAgeRatingConfig,
      appStoreMetadata,
      changedMobileTerms,
      changedWebsiteTerms,
    ),
    ["mobile and website Terms must both retain the 18+ minimum age"],
  );
});
