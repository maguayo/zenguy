import assert from "node:assert/strict";
import test from "node:test";
import {
  missingRequiredSecrets,
  parseSecretList,
} from "./verify-remote-secrets.mjs";

test("parses only Wrangler secret metadata", () => {
  const available = parseSecretList(
    JSON.stringify([
      { name: "ADMIN_USER_IDS", type: "secret_text" },
      { name: "UNRELATED_SECRET", type: "secret_text" },
    ]),
  );
  assert.deepEqual(missingRequiredSecrets(available), []);
  assert.equal(available.has("ADMIN_USER_IDS"), true);
});

test("reports a missing allowlist without accepting values or malformed output", () => {
  assert.deepEqual(missingRequiredSecrets(new Set(["UNRELATED_SECRET"])), [
    "ADMIN_USER_IDS",
  ]);
  assert.throws(() => parseSecretList('{"value":"not-an-array"}'), /invalid/u);
  assert.throws(() => parseSecretList("not-json"), /invalid/u);
  assert.throws(
    () =>
      parseSecretList(
        '[{"name":"ADMIN_USER_IDS","type":"secret_text","value":"must-not-be-consumed"}]',
      ),
    /invalid/u,
  );
  for (const forbidden of ["text", "key_base64", "key_jwk"]) {
    assert.throws(
      () =>
        parseSecretList(
          JSON.stringify([
            {
              name: "ADMIN_USER_IDS",
              type: "secret_text",
              [forbidden]: "must-not-be-consumed",
            },
          ]),
        ),
      /invalid/u,
    );
  }
  assert.throws(
    () => parseSecretList('[{"name":"ADMIN_USER_IDS","type":"plain_text"}]'),
    /invalid/u,
  );
  assert.throws(
    () =>
      parseSecretList(
        '[{"name":"ADMIN_USER_IDS","type":"secret_text"},{"name":"ADMIN_USER_IDS","type":"secret_text"}]',
      ),
    /invalid/u,
  );
});
