import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedAasa,
  htmlPrerequisites,
  validateAasaDocument,
  validateHtmlPrerequisite,
} from "./app-store-public-contract.mjs";

test("accepts every canonical public prerequisite with its reviewed copy", () => {
  for (const definition of htmlPrerequisites) {
    const body = `<html><head><link rel="canonical" href="${definition.url}"></head><body>${definition.invariants.join(" ")}</body></html>`;
    assert.deepEqual(validateHtmlPrerequisite(definition, body), []);
  }
});

test("rejects missing copy, a wrong canonical and production noindex", () => {
  const [definition] = htmlPrerequisites;
  const failures = validateHtmlPrerequisite(
    definition,
    '<html><head><link rel="canonical" href="https://wrong.example/"><meta content="nofollow, noindex" name="robots"></head><body>Incomplete</body></html>',
  );

  assert.equal(failures.includes(`canonical URL must be ${definition.url}`), true);
  assert.equal(
    failures.includes("production App Store prerequisite must remain indexable"),
    true,
  );
  assert.equal(
    failures.includes(`missing published copy ${definition.invariants[0]}`),
    true,
  );
});

test("accepts only the exact existing-account-only AASA route set", () => {
  assert.deepEqual(validateAasaDocument(expectedAasa), []);

  const drifted = structuredClone(expectedAasa);
  drifted.applinks.details[0].components.push({ "/": "/signup" });
  assert.deepEqual(validateAasaDocument(drifted), [
    "AASA does not exactly match the reviewed existing-account-only route set",
  ]);
});
