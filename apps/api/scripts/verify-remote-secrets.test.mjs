import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidKeyBindings,
  invalidTextSecretBindings,
  missingRequiredSecrets,
  parseSecretList,
  requiredKeyBindingsForEnvironment,
  requiredSecretsForEnvironment,
  validateRunnerAccessContract,
} from "./verify-remote-secrets.mjs";

test("flattens versioned core, feature and environment secret groups", () => {
  const inventory = {
    inventoryVersion: 1,
    groups: {
      core: ["A_SECRET", "B2"],
      releaseFeatures: ["FEATURE_SECRET"],
    },
    environments: {
      staging: {
        requiredGroups: ["core", "releaseFeatures"],
        additionalRequired: ["CF_ACCESS_AUD"],
      },
    },
  };
  assert.deepEqual(
    requiredSecretsForEnvironment(inventory, "staging"),
    ["A_SECRET", "B2", "FEATURE_SECRET", "CF_ACCESS_AUD"],
  );
  assert.throws(
    () =>
      requiredSecretsForEnvironment(
        {
          ...inventory,
          groups: { core: ["A_SECRET"], releaseFeatures: ["A_SECRET"] },
        },
        "staging",
      ),
    /Invalid required-secret inventory/u,
  );
  assert.throws(
    () =>
      requiredSecretsForEnvironment(
        {
          ...inventory,
          environments: {
            staging: { requiredGroups: ["missing"], additionalRequired: [] },
          },
        },
        "staging",
      ),
    /Invalid required-secret inventory/u,
  );
});

test("requires a service-only runner Access contract with distinct role identities", () => {
  const contract = {
    contractVersion: 1,
    environments: {
      production: {
        applicationName: "zenguy-production-runner",
        issuerBinding: "CF_ACCESS_TEAM_DOMAIN",
        audienceBinding: "CF_RUNNER_ACCESS_AUD",
        hostnames: ["api.zenguy.com", "app.zenguy.com"],
        path: "/api/runner/*",
        policyType: "service_auth",
        denyByDefault: true,
        allowHumanIdentities: false,
        bypassPolicies: [],
        identities: {
          primary: {
            serviceTokenName: "zenguy-production-primary-runner",
            workerId: "zenguy-production-primary",
            bootstrapBinding: "RUNNER_API_TOKEN",
          },
          fallback: {
            serviceTokenName: "zenguy-production-fallback-runner",
            workerId: "zenguy-production-fallback",
            bootstrapBinding: "RUNNER_FALLBACK_API_TOKEN",
          },
        },
      },
    },
  };

  assert.deepEqual(validateRunnerAccessContract(contract, "production"), {
    applicationName: "zenguy-production-runner",
    issuerBinding: "CF_ACCESS_TEAM_DOMAIN",
    audienceBinding: "CF_RUNNER_ACCESS_AUD",
    hostnames: ["api.zenguy.com", "app.zenguy.com"],
    serviceTokenNames: [
      "zenguy-production-primary-runner",
      "zenguy-production-fallback-runner",
    ],
  });
  assert.throws(
    () =>
      validateRunnerAccessContract(
        {
          ...contract,
          environments: {
            production: {
              ...contract.environments.production,
              allowHumanIdentities: true,
            },
          },
        },
        "production",
      ),
    /Invalid runner Access contract/u,
  );
  assert.throws(
    () =>
      validateRunnerAccessContract(
        {
          ...contract,
          environments: {
            production: {
              ...contract.environments.production,
              audienceBinding: "CF_ACCESS_AUD",
            },
          },
        },
        "production",
      ),
    /Invalid runner Access contract/u,
  );
  assert.throws(
    () =>
      validateRunnerAccessContract(
        {
          ...contract,
          environments: {
            production: {
              ...contract.environments.production,
              identities: {
                ...contract.environments.production.identities,
                fallback: {
                  ...contract.environments.production.identities.fallback,
                  serviceTokenName: "zenguy-production-primary-runner",
                },
              },
            },
          },
        },
        "production",
      ),
    /Invalid runner Access contract/u,
  );
});

test("parses only Wrangler secret metadata and reports missing names", () => {
  const available = parseSecretList(
    JSON.stringify([
      { name: "JWT_SECRET", type: "secret_text" },
      { name: "CF_ACCESS_AUD", type: "secret_text" },
    ]),
  );
  assert.deepEqual(
    missingRequiredSecrets(
      ["CF_ACCESS_AUD", "JWT_SECRET", "RUNNER_API_TOKEN"],
      available,
    ),
    ["RUNNER_API_TOKEN"],
  );
  assert.deepEqual(
    invalidTextSecretBindings(["CF_ACCESS_AUD", "JWT_SECRET"], available),
    [],
  );
  assert.equal(available.get("JWT_SECRET").type, "secret_text");
  assert.throws(() => parseSecretList('{"value":"not-an-array"}'), /invalid/u);
  assert.throws(() => parseSecretList("not-json"), /invalid/u);
  assert.throws(
    () =>
      parseSecretList(
        JSON.stringify([
          { name: "JWT_SECRET", type: "secret_text", text: "forbidden" },
        ]),
      ),
    /invalid/u,
  );
});

test("pins the private Service Binding to the matching KMS key allowlist", () => {
  const api = {
    env: {
      production: {
        vars: { KEY_WRAPPING_KEY_ID: "kek-2026-08" },
        services: [
          {
            binding: "KEY_WRAPPING",
            service: "zenguy-kms-production",
            entrypoint: "KeyWrappingService",
          },
        ],
      },
    },
  };
  const kms = {
    workers_dev: false,
    preview_urls: false,
    env: {
      production: {
        vars: {
          KEY_WRAPPING_KEY_SET: JSON.stringify({
            configVersion: 1,
            activeKeyId: "kek-2026-08",
            writeKeyIds: ["kek-2026-01", "kek-2026-08"],
            keys: [
              { id: "kek-2026-08", binding: "KMS_KEY_2026_08" },
              { id: "kek-2026-01", binding: "KMS_KEY_2026_01" },
            ],
          }),
        },
      },
    },
  };

  assert.deepEqual(requiredKeyBindingsForEnvironment(api, kms, "production"), {
    activeKeyId: "kek-2026-08",
    writeKeyIds: ["kek-2026-01", "kek-2026-08"],
    required: [
      { id: "kek-2026-08", binding: "KMS_KEY_2026_08" },
      { id: "kek-2026-01", binding: "KMS_KEY_2026_01" },
    ],
  });
  assert.throws(
    () =>
      requiredKeyBindingsForEnvironment(
        {
          env: {
            production: {
              ...api.env.production,
              vars: { KEY_WRAPPING_KEY_ID: "not-authorized" },
            },
          },
        },
        kms,
        "production",
      ),
    /Invalid key-wrapping configuration/u,
  );
  assert.throws(
    () =>
      requiredKeyBindingsForEnvironment(
        api,
        { ...kms, workers_dev: true },
        "production",
      ),
    /Invalid key-wrapping configuration/u,
  );
});

test("accepts only metadata for non-exportable AES-256-GCM secret_key bindings", () => {
  const required = [
    { id: "kek-2026-08", binding: "KMS_KEY_2026_08" },
    { id: "kek-2026-01", binding: "KMS_KEY_2026_01" },
  ];
  const valid = parseSecretList(
    JSON.stringify([
      {
        name: "KMS_KEY_2026_08",
        type: "secret_key",
        format: "raw",
        algorithm: { name: "AES-GCM", length: 256 },
        usages: ["encrypt", "decrypt"],
      },
      {
        name: "KMS_KEY_2026_01",
        type: "secret_key",
        format: "raw",
        algorithm: "AES-GCM",
        usages: ["decrypt", "encrypt"],
      },
    ]),
  );
  assert.deepEqual(invalidKeyBindings(required, valid), []);

  const wrongType = new Map(valid);
  wrongType.set("KMS_KEY_2026_08", {
    name: "KMS_KEY_2026_08",
    type: "secret_text",
  });
  assert.deepEqual(invalidKeyBindings(required, wrongType), [
    "KMS_KEY_2026_08",
  ]);

  const valueBearing = new Map(valid);
  valueBearing.set("KMS_KEY_2026_08", {
    ...valid.get("KMS_KEY_2026_08"),
    key_base64: "must-not-be-returned-by-metadata-list",
  });
  assert.deepEqual(invalidKeyBindings(required, valueBearing), [
    "KMS_KEY_2026_08",
  ]);

  const missing = new Map(valid);
  missing.delete("KMS_KEY_2026_01");
  assert.deepEqual(invalidKeyBindings(required, missing), [
    "KMS_KEY_2026_01",
  ]);
});
