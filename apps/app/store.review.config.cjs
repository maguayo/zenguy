const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const baseConfig = require("./store.config.json");

const requiredReviewEnvironment = Object.freeze([
  "APP_REVIEW_CONTACT_FIRST_NAME",
  "APP_REVIEW_CONTACT_LAST_NAME",
  "APP_REVIEW_CONTACT_EMAIL",
  "APP_REVIEW_CONTACT_PHONE",
  "APP_REVIEW_SCREEN_RECORDING_FILENAME",
  "APP_REVIEW_TESTED_DEVICES",
  "MAESTRO_REVIEW_EMAIL",
  "MAESTRO_REVIEW_PASSWORD",
]);
const localFixturePasswords = new Set([
  "Local-demo-password-2026!",
  "Password123!",
]);

function readReviewNotes({ recordingFilename, testedDevices }) {
  const source = readFileSync(
    join(__dirname, "..", "..", "docs", "app-store", "review-notes-en-US.md"),
    "utf8",
  );
  const match = /## Notes to paste\n\n([\s\S]*?)\n\n## Before pasting/u.exec(source);
  if (match === null) throw new Error("App Review metadata: review notes block is missing");
  const notes = match[1]
    .replaceAll("<SCREEN_RECORDING_FILENAME>", recordingFilename)
    .replaceAll("<TESTED_DEVICE_LIST>", testedDevices)
    .trim();
  if (notes.length < 2 || notes.length > 4_000 || /<[A-Z][A-Z0-9_]+>/u.test(notes)) {
    throw new Error("App Review metadata: review notes block is invalid");
  }
  return notes;
}

function takeEnvironment(environment) {
  const values = Object.fromEntries(
    requiredReviewEnvironment.map((name) => [name, environment[name]]),
  );
  for (const name of requiredReviewEnvironment) delete environment[name];
  return values;
}

function requiredTrimmed(values, name) {
  const value = typeof values[name] === "string" ? values[name].trim() : "";
  if (value === "") throw new Error(`App Review metadata: ${name} is missing`);
  return value;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function buildStoreReviewConfig(environment = process.env) {
  const values = takeEnvironment(environment);
  const firstName = requiredTrimmed(values, "APP_REVIEW_CONTACT_FIRST_NAME");
  const lastName = requiredTrimmed(values, "APP_REVIEW_CONTACT_LAST_NAME");
  const contactEmail = requiredTrimmed(values, "APP_REVIEW_CONTACT_EMAIL").toLowerCase();
  const phone = requiredTrimmed(values, "APP_REVIEW_CONTACT_PHONE");
  const recordingFilename = requiredTrimmed(
    values,
    "APP_REVIEW_SCREEN_RECORDING_FILENAME",
  );
  const testedDevices = requiredTrimmed(values, "APP_REVIEW_TESTED_DEVICES");
  const demoUsername = requiredTrimmed(values, "MAESTRO_REVIEW_EMAIL").toLowerCase();
  const demoPassword =
    typeof values.MAESTRO_REVIEW_PASSWORD === "string"
      ? values.MAESTRO_REVIEW_PASSWORD
      : "";
  const phoneDigits = phone.replace(/\D/gu, "");

  if (!validEmail(contactEmail)) {
    throw new Error("App Review metadata: contact email is invalid");
  }
  if (!phone.startsWith("+") || phoneDigits.length < 8 || phoneDigits.length > 15) {
    throw new Error("App Review metadata: contact phone must include a valid country code");
  }
  if (
    !validEmail(demoUsername) ||
    demoUsername.endsWith("@example.com") ||
    demoUsername.endsWith("@zenguy.dev")
  ) {
    throw new Error("App Review metadata: committed local fixture identities are forbidden");
  }
  if (demoPassword.length < 16 || localFixturePasswords.has(demoPassword)) {
    throw new Error("App Review metadata: demo password is missing, too short or forbidden");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:mov|mp4)$/u.test(
      recordingFilename,
    )
  ) {
    throw new Error("App Review metadata: screen-recording filename is invalid");
  }
  if (
    testedDevices.length > 500 ||
    !/^iPhone [^;<>\n]{1,80} — iOS \d+(?:\.\d+){0,2}(?:; iPhone [^;<>\n]{1,80} — iOS \d+(?:\.\d+){0,2})*$/u.test(
      testedDevices,
    )
  ) {
    throw new Error("App Review metadata: tested-device list is invalid");
  }

  const config = JSON.parse(JSON.stringify(baseConfig));
  config.apple.review = {
    firstName,
    lastName,
    email: contactEmail,
    phone,
    demoUsername,
    demoPassword,
    demoRequired: true,
    notes: readReviewNotes({ recordingFilename, testedDevices }),
  };
  return config;
}

module.exports = () => buildStoreReviewConfig(process.env);
module.exports.buildStoreReviewConfig = buildStoreReviewConfig;
module.exports.requiredReviewEnvironment = requiredReviewEnvironment;
