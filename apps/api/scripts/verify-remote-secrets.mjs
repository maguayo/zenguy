import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_ENVIRONMENTS = new Set(["staging", "production"]);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const WRANGLER_ENTRYPOINT = path.join(
  API_DIRECTORY,
  "node_modules/wrangler/bin/wrangler.js",
);
const REQUIRED_SECRET_INVENTORY = path.resolve(
  API_DIRECTORY,
  "../../security/required-worker-secrets.json",
);
const RUNNER_ACCESS_CONTRACT = path.resolve(
  API_DIRECTORY,
  "../../security/cloudflare-runner-access-policy.json",
);
const API_WRANGLER_CONFIG = path.join(API_DIRECTORY, "wrangler.jsonc");
const KMS_WRANGLER_CONFIG = path.join(API_DIRECTORY, "wrangler.kms.jsonc");
const MAX_OUTPUT_BYTES = 256 * 1024;

function isSecretName(name) {
  return typeof name === "string" && /^[A-Z][A-Z0-9_]*$/u.test(name);
}

export function requiredSecretsForEnvironment(inventory, environment) {
  const environmentInventory = inventory?.environments?.[environment];
  const groups = inventory?.groups;
  if (
    inventory?.inventoryVersion !== 1 ||
    groups === null ||
    typeof groups !== "object" ||
    environmentInventory === null ||
    typeof environmentInventory !== "object" ||
    !Array.isArray(environmentInventory.requiredGroups) ||
    environmentInventory.requiredGroups.length === 0 ||
    !Array.isArray(environmentInventory.additionalRequired)
  ) {
    throw new Error(`Invalid required-secret inventory for ${environment}`);
  }

  const required = [];
  for (const groupName of environmentInventory.requiredGroups) {
    const group = groups[groupName];
    if (
      typeof groupName !== "string" ||
      !Array.isArray(group) ||
      group.length === 0 ||
      group.some((name) => !isSecretName(name))
    ) {
      throw new Error(`Invalid required-secret inventory for ${environment}`);
    }
    required.push(...group);
  }
  required.push(...environmentInventory.additionalRequired);
  if (
    required.length === 0 ||
    required.some((name) => !isSecretName(name)) ||
    new Set(required).size !== required.length
  ) {
    throw new Error(`Invalid required-secret inventory for ${environment}`);
  }
  return required;
}

export function parseSecretList(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Wrangler returned an invalid secret inventory");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (binding) =>
        binding === null ||
        typeof binding !== "object" ||
        typeof binding.name !== "string" ||
        Object.hasOwn(binding, "text") ||
        Object.hasOwn(binding, "key_base64") ||
        Object.hasOwn(binding, "key_jwk"),
    )
  ) {
    throw new Error("Wrangler returned an invalid secret inventory");
  }
  if (new Set(parsed.map(({ name }) => name)).size !== parsed.length) {
    throw new Error("Wrangler returned an invalid secret inventory");
  }
  return new Map(parsed.map((binding) => [binding.name, binding]));
}

export function missingRequiredSecrets(required, available) {
  return required.filter((name) => !available.has(name));
}

export function invalidTextSecretBindings(required, available) {
  return required.filter((name) => {
    const binding = available.get(name);
    return binding !== undefined && binding.type !== "secret_text";
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateRunnerAccessContract(contract, environment) {
  const selected = contract?.environments?.[environment];
  const identities = selected?.identities;
  const expectedBootstrap = {
    primary: "RUNNER_API_TOKEN",
    fallback: "RUNNER_FALLBACK_API_TOKEN",
    cf: "RUNNER_CF_API_TOKEN",
  };
  if (
    environment !== "production" ||
    contract?.contractVersion !== 1 ||
    JSON.stringify(Object.keys(contract?.environments ?? {})) !==
      JSON.stringify(["production"]) ||
    !isObject(selected) ||
    typeof selected.applicationName !== "string" ||
    selected.applicationName !== `zenguy-${environment}-runner` ||
    selected.issuerBinding !== "CF_ACCESS_TEAM_DOMAIN" ||
    selected.audienceBinding !== "CF_RUNNER_ACCESS_AUD" ||
    !Array.isArray(selected.hostnames) ||
    selected.hostnames.length !== 2 ||
    selected.hostnames.some(
      (hostname) =>
        typeof hostname !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(
          hostname,
        ),
    ) ||
    new Set(selected.hostnames).size !== selected.hostnames.length ||
    selected.path !== "/api/runner/*" ||
    selected.policyType !== "service_auth" ||
    selected.denyByDefault !== true ||
    selected.allowHumanIdentities !== false ||
    !Array.isArray(selected.bypassPolicies) ||
    selected.bypassPolicies.length !== 0 ||
    !isObject(identities) ||
    JSON.stringify(Object.keys(identities).sort()) !==
      JSON.stringify(["cf", "fallback", "primary"])
  ) {
    throw new Error(`Invalid runner Access contract for ${environment}`);
  }

  const serviceTokenNames = new Set();
  for (const role of ["primary", "fallback", "cf"]) {
    const identity = identities[role];
    if (
      !isObject(identity) ||
      identity.workerId !== `zenguy-${environment}-${role}` ||
      identity.bootstrapBinding !== expectedBootstrap[role] ||
      typeof identity.serviceTokenName !== "string" ||
      identity.serviceTokenName !== `zenguy-${environment}-${role}-runner` ||
      serviceTokenNames.has(identity.serviceTokenName) ||
      (role === "cf"
        ? identity.commonNameBinding !== "RUNNER_CF_ACCESS_COMMON_NAME"
        : identity.commonNameBinding !== undefined)
    ) {
      throw new Error(`Invalid runner Access contract for ${environment}`);
    }
    serviceTokenNames.add(identity.serviceTokenName);
  }
  return {
    applicationName: selected.applicationName,
    issuerBinding: selected.issuerBinding,
    audienceBinding: selected.audienceBinding,
    hostnames: [...selected.hostnames],
    serviceTokenNames: [...serviceTokenNames],
  };
}

function parseJsonConfig(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function requiredKeyBindingsForEnvironment(
  apiConfig,
  kmsConfig,
  environment,
) {
  const kmsEnvironment = kmsConfig?.env?.[environment];
  const apiEnvironment = apiConfig?.env?.[environment];
  if (
    kmsConfig?.workers_dev !== false ||
    kmsConfig?.preview_urls !== false ||
    Object.hasOwn(kmsConfig ?? {}, "routes") ||
    Object.hasOwn(kmsConfig ?? {}, "route") ||
    Object.hasOwn(kmsConfig ?? {}, "triggers") ||
    !isObject(kmsEnvironment?.vars) ||
    typeof kmsEnvironment.vars.KEY_WRAPPING_KEY_SET !== "string" ||
    !Array.isArray(apiEnvironment?.services)
  ) {
    throw new Error(`Invalid key-wrapping configuration for ${environment}`);
  }

  let keySet;
  try {
    keySet = JSON.parse(kmsEnvironment.vars.KEY_WRAPPING_KEY_SET);
  } catch {
    throw new Error(`Invalid key-wrapping configuration for ${environment}`);
  }
  if (
    !isObject(keySet) ||
    keySet.configVersion !== 1 ||
    typeof keySet.activeKeyId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keySet.activeKeyId) ||
    !Array.isArray(keySet.writeKeyIds) ||
    keySet.writeKeyIds.length === 0 ||
    keySet.writeKeyIds.length > 2 ||
    keySet.writeKeyIds.some(
      (keyId) =>
        typeof keyId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId),
    ) ||
    new Set(keySet.writeKeyIds).size !== keySet.writeKeyIds.length ||
    !Array.isArray(keySet.keys) ||
    keySet.keys.length === 0 ||
    keySet.keys.length > 9
  ) {
    throw new Error(`Invalid key-wrapping configuration for ${environment}`);
  }

  const expectedService = {
    binding: "KEY_WRAPPING",
    service: `zenguy-kms-${environment}`,
    entrypoint: "KeyWrappingService",
  };
  if (
    JSON.stringify(apiEnvironment.services) !==
      JSON.stringify([expectedService]) ||
    !keySet.writeKeyIds.includes(apiEnvironment?.vars?.KEY_WRAPPING_KEY_ID)
  ) {
    throw new Error(`Invalid key-wrapping configuration for ${environment}`);
  }

  const ids = new Set();
  const bindings = new Set();
  const required = [];
  for (const candidate of keySet.keys) {
    if (
      !isObject(candidate) ||
      typeof candidate.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(candidate.id) ||
      typeof candidate.binding !== "string" ||
      !/^KMS_KEY_[A-Z0-9_]{1,64}$/u.test(candidate.binding) ||
      ids.has(candidate.id) ||
      bindings.has(candidate.binding)
    ) {
      throw new Error(`Invalid key-wrapping configuration for ${environment}`);
    }
    ids.add(candidate.id);
    bindings.add(candidate.binding);
    required.push({ id: candidate.id, binding: candidate.binding });
  }
  if (
    !ids.has(keySet.activeKeyId) ||
    !keySet.writeKeyIds.includes(keySet.activeKeyId) ||
    keySet.writeKeyIds.some((keyId) => !ids.has(keyId))
  ) {
    throw new Error(`Invalid key-wrapping configuration for ${environment}`);
  }
  return {
    activeKeyId: keySet.activeKeyId,
    writeKeyIds: [...keySet.writeKeyIds],
    required,
  };
}

function isAesGcmAlgorithm(algorithm) {
  return (
    algorithm === "AES-GCM" ||
    (isObject(algorithm) &&
      algorithm.name === "AES-GCM" &&
      (algorithm.length === undefined || algorithm.length === 256))
  );
}

export function invalidKeyBindings(required, available) {
  const invalid = [];
  for (const { binding } of required) {
    const metadata = available.get(binding);
    if (metadata === undefined) {
      invalid.push(binding);
      continue;
    }
    // `wrangler secret list` reports only {name, type}; format, algorithm and
    // usages travel exclusively in richer API metadata. Enforce each field
    // when present rather than failing on its absence, so the preflight can
    // pass against the CLI listing while still rejecting a malformed binding.
    const usages = Array.isArray(metadata.usages)
      ? new Set(metadata.usages)
      : new Set();
    if (
      metadata.type !== "secret_key" ||
      (Object.hasOwn(metadata, "format") && metadata.format !== "raw") ||
      (Object.hasOwn(metadata, "algorithm") &&
        !isAesGcmAlgorithm(metadata.algorithm)) ||
      (Object.hasOwn(metadata, "usages") &&
        (usages.size !== 2 ||
          !usages.has("encrypt") ||
          !usages.has("decrypt"))) ||
      Object.hasOwn(metadata, "key_base64") ||
      Object.hasOwn(metadata, "key_jwk") ||
      Object.hasOwn(metadata, "text")
    ) {
      invalid.push(binding);
    }
  }
  return invalid;
}

function listRemoteSecrets(environment, config) {
  return execFileSync(
    process.execPath,
    [
      WRANGLER_ENTRYPOINT,
      "secret",
      "list",
      "--config",
      config,
      "--env",
      environment,
      "--format",
      "json",
    ],
    {
      cwd: API_DIRECTORY,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    },
  );
}

function main() {
  const environment = process.argv[2];
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      "Choose exactly one remote environment: staging or production",
    );
  }

  const inventory = JSON.parse(readFileSync(REQUIRED_SECRET_INVENTORY, "utf8"));
  const required = requiredSecretsForEnvironment(inventory, environment);
  const runnerAccess =
    environment === "production"
      ? validateRunnerAccessContract(
          parseJsonConfig(RUNNER_ACCESS_CONTRACT),
          environment,
        )
      : null;
  const keyBindings = requiredKeyBindingsForEnvironment(
    parseJsonConfig(API_WRANGLER_CONFIG),
    parseJsonConfig(KMS_WRANGLER_CONFIG),
    environment,
  );
  const apiSecrets = parseSecretList(
    listRemoteSecrets(environment, API_WRANGLER_CONFIG),
  );
  const missing = missingRequiredSecrets(required, apiSecrets);
  if (missing.length > 0) {
    throw new Error(
      `Remote ${environment} Worker is missing required bindings: ${missing.join(", ")}`,
    );
  }
  const invalidText = invalidTextSecretBindings(required, apiSecrets);
  if (invalidText.length > 0) {
    throw new Error(
      `Remote ${environment} Worker has invalid secret binding types: ${invalidText.join(", ")}`,
    );
  }
  const kmsSecrets = parseSecretList(
    listRemoteSecrets(environment, KMS_WRANGLER_CONFIG),
  );
  const invalidKms = invalidKeyBindings(keyBindings.required, kmsSecrets);
  if (invalidKms.length > 0) {
    throw new Error(
      `Remote ${environment} key-wrapping Worker is missing or has invalid non-exportable key bindings: ${invalidKms.join(", ")}`,
    );
  }
  const accessSummary =
    runnerAccess === null
      ? ""
      : `; local Access contract ${runnerAccess.applicationName} covers ${runnerAccess.hostnames.length} hosts and ${runnerAccess.serviceTokenNames.length} service identities`;
  console.log(
    `Remote ${environment} Workers have all ${required.length} text-secret and ${keyBindings.required.length} non-exportable key bindings${accessSummary}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Secret preflight failed");
    process.exitCode = 1;
  }
}
