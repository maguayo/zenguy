import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const dynamicConfig = require("../store.review.config.cjs");
const { buildStoreReviewConfig, requiredReviewEnvironment } = dynamicConfig;

function completeEnvironment() {
  return {
    APP_REVIEW_CONTACT_FIRST_NAME: "Review",
    APP_REVIEW_CONTACT_LAST_NAME: "Contact",
    APP_REVIEW_CONTACT_EMAIL: "review-contact@zenguy.com",
    APP_REVIEW_CONTACT_PHONE: "+34 600 000 000",
    APP_REVIEW_SCREEN_RECORDING_FILENAME: "zenguy-0.2.3-6-review.mp4",
    APP_REVIEW_TESTED_DEVICES: "iPhone 17 Pro — iOS 26.5",
    MAESTRO_REVIEW_EMAIL: "apple-review@zenguy.com",
    MAESTRO_REVIEW_PASSWORD: "Review-only-password-2026!",
  };
}

function assertEnvironmentCleared(environment) {
  for (const name of requiredReviewEnvironment) {
    assert.equal(Object.hasOwn(environment, name), false, `${name} should be deleted`);
  }
}

test("builds review metadata in memory and clears every injected value", () => {
  const environment = completeEnvironment();
  const config = buildStoreReviewConfig(environment);

  assertEnvironmentCleared(environment);
  assert.equal(config.apple.version, "0.2.3");
  assert.deepEqual(config.apple.review, {
    demoPassword: "Review-only-password-2026!",
    demoRequired: true,
    demoUsername: "apple-review@zenguy.com",
    email: "review-contact@zenguy.com",
    firstName: "Review",
    lastName: "Contact",
    notes: config.apple.review.notes,
    phone: "+34 600 000 000",
  });
  assert.match(config.apple.review.notes, /Guideline\s+3\.1\.3\(f\)/u);
  assert.match(config.apple.review.notes, /zenguy-0\.2\.3-6-review\.mp4/u);
  assert.match(config.apple.review.notes, /iPhone 17 Pro — iOS 26\.5/u);
  assert.match(config.apple.review.notes, /Guideline 2\.1 information/u);
  assert.doesNotMatch(config.apple.review.notes, /<[A-Z][A-Z0-9_]+>/u);
  assert.equal(Object.hasOwn(require("../store.config.json").apple, "review"), false);
});

test("rejects incomplete input without retaining or disclosing injected values", () => {
  const environment = completeEnvironment();
  delete environment.APP_REVIEW_CONTACT_FIRST_NAME;
  const sensitiveValues = Object.values(environment);

  assert.throws(
    () => buildStoreReviewConfig(environment),
    (error) => {
      assert.match(error.message, /APP_REVIEW_CONTACT_FIRST_NAME is missing/u);
      for (const value of sensitiveValues) {
        assert.equal(error.message.includes(value), false);
      }
      return true;
    },
  );
  assertEnvironmentCleared(environment);
});

test("rejects committed local account fixtures and clears the environment", () => {
  const environment = completeEnvironment();
  environment.MAESTRO_REVIEW_EMAIL = "owner@example.com";
  environment.MAESTRO_REVIEW_PASSWORD = "Local-demo-password-2026!";

  assert.throws(
    () => buildStoreReviewConfig(environment),
    /committed local fixture identities are forbidden/u,
  );
  assertEnvironmentCleared(environment);
});

test("rejects malformed candidate-specific recording evidence", () => {
  const environment = completeEnvironment();
  environment.APP_REVIEW_SCREEN_RECORDING_FILENAME = "../review.mp4";
  environment.APP_REVIEW_TESTED_DEVICES = "simulator";

  assert.throws(
    () => buildStoreReviewConfig(environment),
    /screen-recording filename is invalid/u,
  );
  assertEnvironmentCleared(environment);
});
