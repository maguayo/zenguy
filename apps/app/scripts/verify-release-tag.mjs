#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [kind, tag] = process.argv.slice(2);
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

let valid = false;
let expected = "";
if (kind === "release") {
  expected = `ios-v${version}`;
  valid = tag === expected;
} else if (kind === "ota") {
  expected = `ios-ota-v${version}-<positive sequence>`;
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  valid = new RegExp(`^ios-ota-v${escapedVersion}-[1-9]\\d*$`, "u").test(tag ?? "");
} else {
  console.error("usage: verify-release-tag.mjs <release|ota> <tag>");
  process.exit(2);
}

if (!valid) {
  console.error(`invalid ${kind} tag ${JSON.stringify(tag)}; expected ${expected}`);
  process.exit(1);
}

console.log(`Verified ${kind} tag ${tag} for app version ${version}.`);
