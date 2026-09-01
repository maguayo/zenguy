#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  htmlPrerequisites,
  validateAasaDocument,
  validateHtmlPrerequisite,
} from "./app-store-public-contract.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function regularFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing; build frontend and website first`);
    return null;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} must be a regular non-symlink build artifact`);
    return null;
  }
  return readFileSync(path);
}

for (const definition of htmlPrerequisites) {
  const bytes = regularFile(
    join(repositoryRoot, "apps", "website", "dist", definition.outputPath),
    definition.url,
  );
  if (bytes === null) continue;
  for (const failure of validateHtmlPrerequisite(definition, bytes.toString("utf8"))) {
    fail(`${definition.url}: ${failure}`);
  }
}

const sourceAasa = regularFile(
  join(
    repositoryRoot,
    "apps",
    "frontend",
    "public",
    ".well-known",
    "apple-app-site-association",
  ),
  "reviewed AASA source",
);
const builtAasa = regularFile(
  join(
    repositoryRoot,
    "apps",
    "frontend",
    "dist",
    ".well-known",
    "apple-app-site-association",
  ),
  "built AASA",
);
if (sourceAasa !== null && builtAasa !== null) {
  if (!sourceAasa.equals(builtAasa)) {
    fail("built AASA bytes differ from the reviewed source");
  }
  if (builtAasa.length >= 128 * 1024) {
    fail("built AASA exceeds Apple's 128 KiB limit");
  }
  try {
    for (const failure of validateAasaDocument(JSON.parse(builtAasa.toString("utf8")))) {
      fail(failure);
    }
  } catch {
    fail("built AASA is not valid JSON");
  }
}

const sourceHeaders = regularFile(
  join(repositoryRoot, "apps", "frontend", "public", "_headers"),
  "reviewed frontend _headers",
);
const builtHeaders = regularFile(
  join(repositoryRoot, "apps", "frontend", "dist", "_headers"),
  "built frontend _headers",
);
if (sourceHeaders !== null && builtHeaders !== null) {
  if (!sourceHeaders.equals(builtHeaders)) {
    fail("built frontend _headers bytes differ from the reviewed source");
  }
  const headers = builtHeaders.toString("utf8");
  for (const invariant of [
    "/.well-known/apple-app-site-association",
    "Cache-Control: public, max-age=3600",
    "Content-Type: application/json",
  ]) {
    if (!headers.includes(invariant)) fail(`built AASA headers are missing ${invariant}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Built App Store public prerequisites verified (support, privacy and exact AASA output).",
  );
}
