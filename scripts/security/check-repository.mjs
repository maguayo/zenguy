import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, relative } from "node:path";

const failures = [];
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const trackedPaths = new Set(tracked);
const releaseTagInGithubActions =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.GITHUB_REF_TYPE === "tag" &&
  /^(?:ios-v|ios-ota-v)/u.test(process.env.GITHUB_REF_NAME ?? "");
const enforceTrackedReleaseArtifacts =
  process.env.ZENGUY_ENFORCE_TRACKED_RELEASE_ARTIFACTS === "1" ||
  releaseTagInGithubActions;
if (enforceTrackedReleaseArtifacts) {
  // Do not impose a clean-HEAD policy on ordinary local development. Release
  // jobs opt in explicitly, and GitHub tag jobs are protected even if that
  // workflow flag is removed accidentally.
  for (const path of [
    ".github/CODEOWNERS",
    ".github/workflows/ios-ota.yml",
    ".github/workflows/ios-release.yml",
    ".node-version",
    "apps/app/app.config.ts",
    "apps/app/certs/updates-certificate.pem",
    "apps/app/eas.json",
    "apps/app/package.json",
    "apps/app/plugins/with-universal-links-only.js",
    "apps/app/pnpm-lock.yaml",
    "apps/app/pnpm-workspace.yaml",
    "apps/app/scripts/verify-release-config.mjs",
    "apps/app/scripts/verify-release-tag.mjs",
    "apps/frontend/public/.well-known/apple-app-site-association",
    "scripts/security/check-repository.mjs",
  ]) {
    if (!trackedPaths.has(path) || !existsSync(path)) {
      failures.push(`${path}: critical release artifact must exist in the release commit`);
    }
  }
}
const allowedPublicCertificate = "apps/app/certs/updates-certificate.pem";
const forbiddenExtensions = new Set([".key", ".mobileprovision", ".p12", ".p8"]);
const forbiddenNames = new Set(["credentials.json", ".dev.vars", ".env.local"]);

function parseAssignments(contents) {
  const values = new Map();
  for (const sourceLine of contents.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }
  return values;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

for (const path of tracked) {
  // A local pre-commit run can legitimately see a tracked file that has been
  // deleted in the working tree. The committed CI tree will not contain it.
  if (!existsSync(path)) continue;
  const name = basename(path);
  const extension = extname(path).toLowerCase();
  if (
    forbiddenExtensions.has(extension) ||
    forbiddenNames.has(name) ||
    (name.startsWith(".dev.vars") && name !== ".dev.vars.example")
  ) {
    failures.push(`${path}: credential filename must not be tracked`);
    continue;
  }
  if (extension === ".pem" && path !== allowedPublicCertificate) {
    failures.push(`${path}: only the public OTA certificate may be tracked as PEM`);
    continue;
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  const content = readFileSync(path, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content)) {
    failures.push(`${path}: tracked private-key material`);
  }
}

const sensitiveLocalPaths = new Set([
  "apps/api/.dev.vars",
  "apps/api/.ci.staging.vars",
  "apps/frontend/.env.local",
  "apps/app/.env.local",
  "apps/app/credentials/updates-private-key.pem",
  "runner/.browser_worker.local.json",
  "TWILIO_TOKENS.md",
]);
for (const name of readdirSync("apps/api")) {
  if (name.startsWith(".dev.vars") && name !== ".dev.vars.example") {
    sensitiveLocalPaths.add(`apps/api/${name}`);
  }
}
for (const path of sensitiveLocalPaths) {
  const stat = lstatIfPresent(path);
  if (stat === null) continue;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    failures.push(
      `${path}: sensitive local config must be a regular file, not a symlink`,
    );
    continue;
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    failures.push(`${path}: sensitive local config has the wrong owner`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    failures.push(`${path}: sensitive local config must use mode 0600`);
  }
}

const localWranglerState = "apps/api/.wrangler";
{
  const stat = lstatIfPresent(localWranglerState);
  if (stat !== null) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      failures.push(
        `${localWranglerState}: local runtime state must be a directory, not a symlink`,
      );
    } else {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        failures.push(
          `${localWranglerState}: local runtime state has the wrong owner`,
        );
      }
      // The directory contains local D1/KV/R2 data. A private root prevents
      // other host users from traversing it even if a tool creates a child with
      // its ordinary 0644/0755 defaults.
      if ((stat.mode & 0o777) !== 0o700) {
        failures.push(
          `${localWranglerState}: local runtime state must use mode 0700`,
        );
      }
    }
  }
}

const localApiVarsPath = "apps/api/.dev.vars";
const publicExampleAssignments = parseAssignments(
  readFileSync("apps/api/.dev.vars.example", "utf8"),
);
if (publicExampleAssignments.size !== 0) {
  failures.push(
    "apps/api/.dev.vars.example: local secret inventory must remain assignment-free",
  );
}
// A legacy file may remain temporarily while its owner completes the explicit
// Keychain migration documented in apps/api/README.md. This guard verifies
// only owner/type/mode metadata above: opening the file would copy every local
// credential into this long-lived Node process and contradict the Keychain
// transport boundary. The API wrapper never consumes this path.
const repositoryGuardSource = readFileSync(
  "scripts/security/check-repository.mjs",
  "utf8",
);
const forbiddenLocalVarsRead = ["readFileSync(", "localApiVarsPath"].join("");
if (repositoryGuardSource.includes(forbiddenLocalVarsRead)) {
  failures.push(
    "check-repository.mjs: repository checks must never open the legacy local vars file",
  );
}

const certificate = readFileSync(allowedPublicCertificate, "utf8");
if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
  failures.push(`${allowedPublicCertificate}: missing X.509 public certificate`);
}
if (certificate.includes("PRIVATE KEY")) {
  failures.push(`${allowedPublicCertificate}: public certificate contains private material`);
}

const pinnedNode = readFileSync(".node-version", "utf8").trim();
for (const path of ["package.json", "apps/app/package.json"]) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.engines?.node !== pinnedNode) {
    failures.push(`${path}: engines.node must exactly match .node-version (${pinnedNode})`);
  }
}
const appManifest = JSON.parse(readFileSync("apps/app/package.json", "utf8"));
if (appManifest.devDependencies?.["expo-doctor"] !== "1.20.2") {
  failures.push("apps/app/package.json: expo-doctor must remain pinned exactly to 1.20.2");
}
if (appManifest.devDependencies?.["eas-cli"] !== "22.0.0") {
  failures.push("apps/app/package.json: eas-cli must remain pinned exactly to 22.0.0");
}
const appLockfile = readFileSync("apps/app/pnpm-lock.yaml", "utf8");
if (
  !/^ {6}eas-cli:\n {8}specifier: 22\.0\.0\n {8}version: 22\.0\.0(?:\(|$)/mu.test(
    appLockfile,
  ) ||
  !/^ {2}eas-cli@22\.0\.0:\n {4}resolution: \{integrity: sha512-[A-Za-z0-9+/]+=*\}$/mu.test(
    appLockfile,
  )
) {
  failures.push(
    "apps/app/pnpm-lock.yaml: eas-cli 22.0.0 must remain a direct, integrity-pinned dependency",
  );
}

const apiManifest = JSON.parse(readFileSync("apps/api/package.json", "utf8"));
const apiScripts = apiManifest.scripts ?? {};
const apiTsconfig = JSON.parse(readFileSync("apps/api/tsconfig.json", "utf8"));
if (
  apiScripts.typecheck !== "wrangler types --check && tsc --noEmit" ||
  !apiTsconfig.include?.includes("worker-configuration.d.ts") ||
  apiTsconfig.compilerOptions?.types?.includes("@cloudflare/workers-types") ||
  Object.hasOwn(apiManifest.dependencies ?? {}, "@cloudflare/workers-types") ||
  Object.hasOwn(apiManifest.devDependencies ?? {}, "@cloudflare/workers-types") ||
  !readFileSync("apps/api/worker-configuration.d.ts", "utf8").startsWith(
    "/* eslint-disable */\n// Generated by Wrangler",
  )
) {
  failures.push(
    "apps/api: Worker bindings/runtime types must be generated by Wrangler and checked before TypeScript",
  );
}
for (const [name, expected] of [
  ["dev", "node scripts/local-secrets.mjs run dev"],
  ["seed", "node scripts/local-secrets.mjs run seed"],
  ["secrets:list", "node scripts/local-secrets.mjs list"],
  ["secrets:status", "node scripts/local-secrets.mjs status"],
  ["secrets:audit-local", "node scripts/local-secrets.mjs audit-local"],
  ["secrets:verify", "node scripts/local-secrets.mjs verify"],
  ["secrets:set", "node scripts/local-secrets.mjs set"],
  [
    "deploy:preflight:staging",
    "node scripts/verify-remote-secrets.mjs staging",
  ],
  [
    "deploy:preflight:production",
    "node scripts/verify-remote-secrets.mjs production",
  ],
]) {
  if (apiScripts[name] !== expected) {
    failures.push(`apps/api/package.json: ${name} must use the Keychain loader`);
  }
}
if (Object.hasOwn(apiScripts, "dev:remote")) {
  failures.push(
    "apps/api/package.json: remote development with local credentials is forbidden",
  );
}
if (
  Object.hasOwn(apiScripts, "seed:staging") ||
  existsSync("apps/api/scripts/reseed-staging.mjs")
) {
  failures.push(
    "apps/api: deterministic fixtures must not have a remote staging entrypoint",
  );
}
const localSecretLoader = readFileSync(
  "apps/api/scripts/local-secrets.mjs",
  "utf8",
);
for (const invariant of [
  'KEYCHAIN_SERVICE = "com.zenguy.api.local-development.v1"',
  'SECURITY_BINARY = "/usr/bin/security"',
  'MKFIFO_BINARY = "/usr/bin/mkfifo"',
  "LOCAL_SENSITIVE_FILES",
  "assertPrivateLocalSecretFile",
  "stat.isSymbolicLink()",
  "(stat.mode & 0o777) !== 0o600",
  '"find-generic-password"',
  '"add-generic-password"',
  '"node_modules/wrangler/bin/wrangler.js"',
  '"scripts/local-secret-fifo-writer.mjs"',
  'mkdtempSync(join(tmpdir(), "zenguy-api-secrets-")',
  '"bindings.env"',
  "fifoStat.isFIFO()",
  "buildSafeChildEnvironment()",
  'PATH: "/usr/bin:/bin:/usr/sbin:/sbin"',
  '"/dev/fd/3"',
  '"--env-file"',
  '"--vars-file"',
  "assertSafeDevelopmentArguments(arguments_)",
  '"wrangler dev accepts only --port',
  '"--port must be one unique TCP port',
  'argument === "--remote"',
  'payloadBuffer.fill(0)',
]) {
  if (!localSecretLoader.includes(invariant)) {
    failures.push(`local-secrets.mjs: missing secure-loader invariant ${invariant}`);
  }
}
if (
  localSecretLoader.includes('"-A"') ||
  localSecretLoader.includes("env: process.env") ||
  localSecretLoader.includes("...process.env") ||
  localSecretLoader.includes("writeFileSync(")
) {
  failures.push(
    "local-secrets.mjs: Keychain must not trust every app, expose the host environment, or persist secret bytes",
  );
}
if (
  !/"dev",\s*"--env-file",\s*secretPath,\s*"--ip",\s*"127\.0\.0\.1",\s*"--inspector-ip",\s*"127\.0\.0\.1"/u.test(
    localSecretLoader,
  )
) {
  failures.push(
    "local-secrets.mjs: Wrangler and its inspector must bind to fixed loopback addresses",
  );
}
const localSecretFifoWriter = readFileSync(
  "apps/api/scripts/local-secret-fifo-writer.mjs",
  "utf8",
);
for (const invariant of [
  'descriptorPath = "/dev/fd/3"',
  "fifoStat.isFIFO()",
  "openedStat.isFIFO()",
  "constants.O_NOFOLLOW",
  "constants.O_NONBLOCK",
  "openedStat.dev !== fifoStat.dev",
  "await handle.write(",
  "process.ppid === supervisorPid",
  "process.kill(supervisorPid, 0)",
  "payload.fill(0)",
  "REOPEN_DELAY_MS",
]) {
  if (!localSecretFifoWriter.includes(invariant)) {
    failures.push(
      `local-secret-fifo-writer.mjs: missing private-FIFO invariant ${invariant}`,
    );
  }
}
const localSeed = readFileSync("apps/api/scripts/seed.mjs", "utf8");
for (const invariant of [
  'varsFile: null',
  'ANONYMOUS_DESCRIPTOR_PATH = "/dev/fd/3"',
  '"node_modules/wrangler/bin/wrangler.js"',
  "assertPrivateVarsSource(options.varsFile)",
  "buildSafeChildEnvironment()",
  'stdio: ["inherit", "inherit", "inherit", "pipe"]',
  "sqlPayload.fill(0)",
]) {
  if (!localSeed.includes(invariant)) {
    failures.push(`seed.mjs: missing memory-only seed invariant ${invariant}`);
  }
}
if (
  localSeed.includes(".seed.generated.sql") ||
  localSeed.includes('spawn("npx"') ||
  localSeed.includes("writeFile(")
) {
  failures.push(
    "seed.mjs: generated SQL must use the anonymous descriptor and fixed local Wrangler entrypoint",
  );
}
if (
  localSecretFifoWriter.includes("writeFileSync(fifoPath") ||
  localSecretFifoWriter.includes("appendFileSync")
) {
  failures.push(
    "local-secret-fifo-writer.mjs: secret bytes may be written only to the verified FIFO descriptor",
  );
}
const gitignore = readFileSync(".gitignore", "utf8").split(/\r?\n/u);
if (!gitignore.includes(".dev.vars*") || !gitignore.includes("!.dev.vars.example")) {
  failures.push(
    ".gitignore: all local Wrangler vars files must be ignored except the assignment-free example",
  );
}
if (
  apiScripts["db:migrate:local"] !==
  "wrangler d1 migrations apply zenguy-local-db --local"
) {
  failures.push(
    "apps/api/package.json: local migrations must target only zenguy-local-db",
  );
}
if (Object.hasOwn(apiScripts, "db:migrate:remote")) {
  failures.push(
    "apps/api/package.json: unscoped remote migration aliases are forbidden",
  );
}
for (const [environment, database] of [
  ["staging", "zenguy-staging-db"],
  ["production", "zenguy-db"],
]) {
  const expected = `wrangler d1 migrations apply ${database} --remote --env ${environment}`;
  if (apiScripts[`db:migrate:${environment}`] !== expected) {
    failures.push(
      `apps/api/package.json: ${environment} migrations must use an explicit environment`,
    );
  }
}

const apiWranglerConfig = readFileSync("apps/api/wrangler.jsonc", "utf8");
const parsedApiWranglerConfig = JSON.parse(apiWranglerConfig);
const coreRequiredRemoteSecrets = [
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "ARTIFACT_URL_SECRET",
  "RUNNER_API_TOKEN",
  "RUNNER_FALLBACK_API_TOKEN",
  "RUNNER_CAPABILITY_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_SMS",
  "TWILIO_FROM_CALL",
];
const releaseFeatureRemoteSecrets = [
  "TWILIO_FROM_WHATSAPP",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "PADDLE_OVERAGE_PRICE_ID",
  "PADDLE_ALERT_CREDIT_PRODUCT_ID",
  "PADDLE_ALERT_CREDIT_PRICE_ID",
  "EXPO_PUSH_ACCESS_TOKEN",
];
const requiredWorkerSecrets = JSON.parse(
  readFileSync("security/required-worker-secrets.json", "utf8"),
);
if (
  JSON.stringify(requiredWorkerSecrets) !==
  JSON.stringify({
    inventoryVersion: 1,
    groups: {
      core: coreRequiredRemoteSecrets,
      releaseFeatures: releaseFeatureRemoteSecrets,
    },
    environments: {
      staging: {
        requiredGroups: ["core", "releaseFeatures"],
        additionalRequired: ["CF_ACCESS_AUD"],
      },
      production: {
        requiredGroups: ["core", "releaseFeatures"],
        additionalRequired: ["CF_RUNNER_ACCESS_AUD"],
      },
    },
  })
) {
  failures.push(
    "security/required-worker-secrets.json: core, complete release features and staging Access must remain required",
  );
}
const runnerAccessPolicy = JSON.parse(
  readFileSync("security/cloudflare-runner-access-policy.json", "utf8"),
);
if (
  runnerAccessPolicy.contractVersion !== 1 ||
  JSON.stringify(Object.keys(runnerAccessPolicy.environments ?? {})) !==
    JSON.stringify(["production"])
) {
  failures.push(
    "security/cloudflare-runner-access-policy.json: the production runner Access contract must remain singular and versioned",
  );
}
for (const [environment, hostnames] of [
  ["production", ["api.zenguy.com", "app.zenguy.com"]],
]) {
  const expected = {
    applicationName: `zenguy-${environment}-runner`,
    issuerBinding: "CF_ACCESS_TEAM_DOMAIN",
    audienceBinding: "CF_RUNNER_ACCESS_AUD",
    hostnames,
    path: "/api/runner/*",
    policyType: "service_auth",
    denyByDefault: true,
    allowHumanIdentities: false,
    bypassPolicies: [],
    identities: {
      primary: {
        serviceTokenName: `zenguy-${environment}-primary-runner`,
        workerId: `zenguy-${environment}-primary`,
        bootstrapBinding: "RUNNER_API_TOKEN",
      },
      fallback: {
        serviceTokenName: `zenguy-${environment}-fallback-runner`,
        workerId: `zenguy-${environment}-fallback`,
        bootstrapBinding: "RUNNER_FALLBACK_API_TOKEN",
      },
    },
  };
  if (
    JSON.stringify(runnerAccessPolicy.environments?.[environment]) !==
      JSON.stringify(expected)
  ) {
    failures.push(
      `security/cloudflare-runner-access-policy.json: ${environment} must protect both runner hosts with distinct service-only primary/fallback identities and no bypass`,
    );
  }
}
const runnerAccessGuard = readFileSync(
  "apps/api/src/http/middleware/runner_access.ts",
  "utf8",
);
const apiWorkerEntrypoint = readFileSync("apps/api/src/index.ts", "utf8");
const runnerRuntime = readFileSync("runner/browser_worker.py", "utf8");
const runnerAccessCall = apiWorkerEntrypoint.indexOf(
  "await enforceProductionRunnerAccess(",
);
const applicationDispatch = apiWorkerEntrypoint.indexOf(
  "return buildApp(env).fetch(request, env, context);",
);
if (
  !runnerAccessGuard.includes('algorithms: ["RS256"]') ||
  !runnerAccessGuard.includes('requiredClaims: ["sub", "iat", "exp", "type", "common_name"]') ||
  !runnerAccessGuard.includes('payload.sub === ""') ||
  !runnerAccessGuard.includes("payload.common_name === expectedCommonName") ||
  !runnerAccessGuard.includes('"zenguy-production-primary": "zenguy-production-primary-runner"') ||
  !runnerAccessGuard.includes('"zenguy-production-fallback": "zenguy-production-fallback-runner"') ||
  runnerAccessCall === -1 ||
  applicationDispatch === -1 ||
  runnerAccessCall > applicationDispatch ||
  (runnerRuntime.match(/"X-Zenguy-Worker-Id": self\.worker_id/gu)?.length ?? 0) < 2
) {
  failures.push(
    "SEC-04: production runner requests must bind the verified Access service identity to the declared worker before application dispatch",
  );
}
function expectedRemoteSecrets(environment) {
  const inventory = requiredWorkerSecrets.environments[environment];
  return [
    ...inventory.requiredGroups.flatMap(
      (group) => requiredWorkerSecrets.groups[group],
    ),
    ...inventory.additionalRequired,
  ];
}

const expectedDefaultWorkerSecrets = [
  ...coreRequiredRemoteSecrets,
  ...releaseFeatureRemoteSecrets,
];
for (const [environment, actual, expected] of [
  ["default", parsedApiWranglerConfig.secrets?.required, expectedDefaultWorkerSecrets],
  [
    "staging",
    parsedApiWranglerConfig.env?.staging?.secrets?.required,
    expectedRemoteSecrets("staging"),
  ],
  [
    "production",
    parsedApiWranglerConfig.env?.production?.secrets?.required,
    expectedRemoteSecrets("production"),
  ],
]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `apps/api/wrangler.jsonc: ${environment} secrets.required must exactly mirror the canonical remote-secret inventory`,
    );
  }
}
const remoteSecretPreflight = readFileSync(
  "apps/api/scripts/verify-remote-secrets.mjs",
  "utf8",
);
if (
  !remoteSecretPreflight.includes('"../../security/required-worker-secrets.json"') ||
  !remoteSecretPreflight.includes(
    '"../../security/cloudflare-runner-access-policy.json"',
  ) ||
  !remoteSecretPreflight.includes("validateRunnerAccessContract(") ||
  !remoteSecretPreflight.includes('"wrangler.jsonc"') ||
  !remoteSecretPreflight.includes('"wrangler.kms.jsonc"') ||
  !remoteSecretPreflight.includes('metadata.type !== "secret_key"') ||
  !remoteSecretPreflight.includes('metadata.format !== "raw"')
) {
  failures.push(
    "verify-remote-secrets.mjs: release preflight must consume the canonical inventories and require secret_key metadata",
  );
}
for (const path of [
  "apps/api/src/infrastructure/llm/openai.ts",
  "apps/api/src/infrastructure/paddle/client.ts",
  "apps/api/src/infrastructure/notify/discord.ts",
  "apps/api/src/infrastructure/notify/expo_push.ts",
  "apps/api/src/infrastructure/notify/twilio.ts",
]) {
  const source = readFileSync(path, "utf8");
  if (
    !source.includes("readLimited") ||
    /\b[A-Za-z]*[Rr]esponse\.(?:arrayBuffer|blob|json|text)\s*\(/u.test(source)
  ) {
    failures.push(
      `${path}: upstream provider bodies must be counted and capped before buffering`,
    );
  }
}
for (const path of [
  "apps/api/src/infrastructure/paddle/client.ts",
  "apps/api/src/infrastructure/notify/discord.ts",
  "apps/api/src/infrastructure/notify/expo_push.ts",
  "apps/api/src/infrastructure/notify/slack.ts",
  "apps/api/src/infrastructure/notify/twilio.ts",
]) {
  if (!readFileSync(path, "utf8").includes("externalProviderSignal()")) {
    failures.push(`${path}: non-streaming provider calls require a finite deadline`);
  }
}
const paddleClientSource = readFileSync(
  "apps/api/src/infrastructure/paddle/client.ts",
  "utf8",
);
const uptimeCheckSource = readFileSync(
  "apps/api/src/application/uptime/execute_check.ts",
  "utf8",
);
const adminLoginSource = readFileSync(
  "apps/admin/src/server/routes/auth.ts",
  "utf8",
);
if (
  !paddleClientSource.includes("const MAX_PADDLE_PAGES = 10") ||
  !uptimeCheckSource.includes("await response.body?.cancel().catch(() => undefined)") ||
  !adminLoginSource.includes("const UPSTREAM_TIMEOUT_MS = 10_000") ||
  !adminLoginSource.includes("const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1_024") ||
  !adminLoginSource.includes("readLimitedJsonResponse(") ||
  !adminLoginSource.includes("cancelResponseBody(response)")
) {
  failures.push(
    "SEC-55: upstream calls must have deadlines, bounded pagination/bodies and explicit cancellation when bodies are ignored",
  );
}
const kmsWranglerConfig = readFileSync("apps/api/wrangler.kms.jsonc", "utf8");
const parsedKmsWranglerConfig = JSON.parse(kmsWranglerConfig);
if (
  parsedKmsWranglerConfig.workers_dev !== false ||
  parsedKmsWranglerConfig.preview_urls !== false ||
  Object.hasOwn(parsedKmsWranglerConfig, "routes") ||
  Object.hasOwn(parsedKmsWranglerConfig, "route") ||
  Object.hasOwn(parsedKmsWranglerConfig, "triggers") ||
  Object.hasOwn(parsedKmsWranglerConfig, "unsafe")
) {
  failures.push(
    "apps/api/wrangler.kms.jsonc: key-wrapping Worker must remain private and use no unsafe bindings",
  );
}
for (const environment of ["staging", "production"]) {
  const expectedService = {
    binding: "KEY_WRAPPING",
    service: `zenguy-kms-${environment}`,
    entrypoint: "KeyWrappingService",
  };
  const apiEnvironment = parsedApiWranglerConfig.env?.[environment];
  const kmsEnvironment = parsedKmsWranglerConfig.env?.[environment];
  let kmsKeySet = null;
  try {
    kmsKeySet = JSON.parse(kmsEnvironment?.vars?.KEY_WRAPPING_KEY_SET ?? "");
  } catch {
    // The invariant below reports one stable repository error.
  }
  if (
    JSON.stringify(apiEnvironment?.services) !==
      JSON.stringify([expectedService]) ||
    kmsEnvironment?.vars?.ENVIRONMENT !== environment ||
    kmsKeySet?.configVersion !== 1 ||
    !Array.isArray(kmsKeySet?.writeKeyIds) ||
    !kmsKeySet.writeKeyIds.includes(apiEnvironment?.vars?.KEY_WRAPPING_KEY_ID) ||
    !Array.isArray(kmsKeySet?.keys) ||
    kmsKeySet.keys.length === 0 ||
    kmsKeySet.keys.some(
      (key) =>
        typeof key?.id !== "string" ||
        typeof key?.binding !== "string" ||
        !key.binding.startsWith("KMS_KEY_"),
    ) ||
    Object.keys(kmsEnvironment?.vars ?? {}).some((name) =>
      name.startsWith("KMS_KEY_"),
    )
  ) {
    failures.push(
      `apps/api Worker configs: ${environment} must pin the private KMS service, active write ID and metadata-only key allowlist`,
    );
  }
}
const keyWrappingWorker = readFileSync(
  "apps/api/src/key_wrapping_worker.ts",
  "utf8",
);
const apiConfigSource = readFileSync("apps/api/src/shared/config.ts", "utf8");
if (
  !keyWrappingWorker.includes("value.extractable") ||
  !keyWrappingWorker.includes('algorithm.name !== "AES-GCM"') ||
  !keyWrappingWorker.includes("extends WorkerEntrypoint") ||
  keyWrappingWorker.includes("fetch(request") ||
  !apiConfigSource.includes('parsed.ENVIRONMENT !== "development"') ||
  !apiConfigSource.includes("new CloudflareKeyWrappingProvider")
) {
  failures.push(
    "SEC-23: named environments must use the private non-exportable AES-GCM key-wrapping provider without a public KMS fetch handler",
  );
}
const apiIntegrationVitestConfig = readFileSync(
  "apps/api/vitest.integration.config.ts",
  "utf8",
);
const apiIntegrationWranglerConfig = readFileSync(
  "apps/api/test/wrangler.jsonc",
  "utf8",
);
if (
  !apiIntegrationVitestConfig.includes(
    'wrangler: { configPath: "./test/wrangler.jsonc" }',
  )
) {
  failures.push(
    "apps/api/vitest.integration.config.ts: integration tests must resolve Wrangler vars outside the .dev.vars directory",
  );
}
for (const secretBinding of [
  "ENCRYPTION_KEY",
  "JWT_SECRET",
  "RUNNER_API_TOKEN",
  "TWILIO_AUTH_TOKEN",
]) {
  if (apiIntegrationWranglerConfig.includes(`"${secretBinding}"`)) {
    failures.push(
      `apps/api/test/wrangler.jsonc: synthetic integration config must not declare ${secretBinding}`,
    );
  }
}
const productionBootstrapConfig = readFileSync(
  "apps/api/wrangler.production-bootstrap.jsonc",
  "utf8",
);
for (const [path, content] of [
  ["apps/api/wrangler.jsonc", apiWranglerConfig],
  ["apps/api/wrangler.production-bootstrap.jsonc", productionBootstrapConfig],
]) {
  if (
    !content.includes(
      '"compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"]',
    )
  ) {
    failures.push(
      `${path}: same-zone fetches must remain subject to the public edge path`,
    );
  }
}

const apiApp = readFileSync("apps/api/src/app.ts", "utf8");
const apiStrictBodyLimit = readFileSync(
  "apps/api/src/http/middleware/strict_body_limit.ts",
  "utf8",
);
const adminApp = readFileSync("apps/admin/src/server/app.ts", "utf8");
const adminStrictBodyLimit = readFileSync(
  "apps/admin/src/server/strict_body_limit.ts",
  "utf8",
);
for (const [path, content] of [
  ["apps/api/src/http/middleware/strict_body_limit.ts", apiStrictBodyLimit],
  ["apps/admin/src/server/strict_body_limit.ts", adminStrictBodyLimit],
]) {
  for (const invariant of [
    "size += value.byteLength",
    "await reader.cancel()",
    "context.req.raw = new Request(request, requestInit)",
  ]) {
    if (!content.includes(invariant)) {
      failures.push(`${path}: missing counted-stream body limit invariant ${invariant}`);
    }
  }
}
if (
  !apiApp.includes("MAX_PADDLE_WEBHOOK_BODY_BYTES") ||
  !apiApp.includes("MAX_API_REQUEST_BODY_BYTES") ||
  !apiApp.includes("strictBodyLimit({") ||
  !adminApp.includes("MAX_ADMIN_API_REQUEST_BODY_BYTES") ||
  !adminApp.includes("strictBodyLimit({") ||
  apiApp.includes('from "hono/body-limit"') ||
  adminApp.includes('from "hono/body-limit"')
) {
  failures.push(
    "API/admin apps: every parser must remain behind a stream-counted body cap",
  );
}

const rateLimiter = readFileSync("apps/api/src/shared/ratelimit.ts", "utf8");
const atomicLimitsMigration = readFileSync(
  "apps/api/migrations/0027_atomic_limits.sql",
  "utf8",
);
for (const invariant of [
  "export class D1RateLimiter",
  "async hitMany(",
  "WITH requested(rate_key) AS (VALUES",
  "WHERE NOT EXISTS (",
  "existing.request_count >= ?",
  "ON CONFLICT(rate_key, window_start) DO UPDATE SET",
  "RETURNING rate_key",
  "rows.results.length === uniqueKeys.length",
]) {
  if (!rateLimiter.includes(invariant)) {
    failures.push(`ratelimit.ts: missing D1 atomic limiter invariant ${invariant}`);
  }
}
if (
  !apiApp.includes("new D1RateLimiter(env.DB, clock)") ||
  !atomicLimitsMigration.includes("PRIMARY KEY (rate_key, window_start)") ||
  rateLimiter.includes("KvRateLimiter")
) {
  failures.push("API rate limiting must remain D1-backed and constraint-atomic");
}

const workspaceAllowanceMigrationPath =
  "apps/api/migrations/0043_workspace_run_allowance_scope.sql";
const workspaceAllowanceMigration = readFileSync(
  workspaceAllowanceMigrationPath,
  "utf8",
);
const runCostMigration = readFileSync(
  "apps/api/migrations/0036_run_cost_caps.sql",
  "utf8",
);
const createRunUseCase = readFileSync(
  "apps/api/src/application/browser_tests/create_run.ts",
  "utf8",
);
if (
  !workspaceAllowanceMigration.includes(
    "DROP TRIGGER enforce_complimentary_run_cap;",
  ) ||
  workspaceAllowanceMigration.includes(
    "CREATE TRIGGER enforce_complimentary_run_cap",
  ) ||
  createRunUseCase.includes("ZENGUY_COMPLIMENTARY_RUN_CAP")
) {
  failures.push(
    `${workspaceAllowanceMigrationPath}: the 300 included runs must remain per-workspace usage, never an owner-wide hard cap`,
  );
}
for (const invariant of [
  "scope_kind IN ('WORKSPACE', 'USER', 'OWNER', 'GLOBAL')",
  "CREATE TRIGGER reserve_workspace_run_quota",
  "CREATE TRIGGER reserve_owner_run_quota",
  "CREATE TRIGGER reserve_global_run_quota",
  "ZENGUY_OWNER_MONTHLY_RUN_CAP",
  "ZENGUY_GLOBAL_MONTHLY_RUN_CAP",
]) {
  if (!runCostMigration.includes(invariant)) {
    failures.push(
      `0036_run_cost_caps.sql: missing independent run-cost invariant ${invariant}`,
    );
  }
}

const browserTestTransfer = readFileSync(
  "apps/api/src/domain/browser_tests/transfer.ts",
  "utf8",
);
const browserTestExport = readFileSync(
  "apps/api/src/application/browser_tests/export_browser_tests.ts",
  "utf8",
);
const browserTestRoutes = readFileSync(
  "apps/api/src/http/routes/browser_tests.ts",
  "utf8",
);
for (const invariant of [
  "MAX_TRANSFER_TESTS = MAX_BROWSER_TESTS_PER_WORKSPACE",
  "tests: z.array(transferEntrySchema).min(1).max(MAX_TRANSFER_TESTS)",
]) {
  if (!browserTestTransfer.includes(invariant)) {
    failures.push(`browser-test transfer: missing 200-test invariant ${invariant}`);
  }
}
for (const invariant of [
  "BROWSER_TEST_EXPORT_PAGE_SIZE = 100",
  "pageSize + 1",
  "entries.length >= MAX_TRANSFER_TESTS",
  "getChannelIdsForTests",
]) {
  if (!browserTestExport.includes(invariant)) {
    failures.push(`browser-test export: missing bounded pagination invariant ${invariant}`);
  }
}
if (
  !browserTestRoutes.includes("new ExportBrowserTests(dependencies.tests)") ||
  !browserTestRoutes.includes("serializeTestsFile(entries, format)")
) {
  failures.push(
    "browser-test export route must use the dedicated bounded two-page collector",
  );
}

const registerUseCase = readFileSync(
  "apps/api/src/application/auth/register.ts",
  "utf8",
);
const loginUseCase = readFileSync(
  "apps/api/src/application/auth/login.ts",
  "utf8",
);
for (const invariant of [
  "existingAccountResponse",
  "renderRegistrationAttemptEmail",
  "registrationPending: true",
  "insertIfAbsent(user)",
]) {
  if (!registerUseCase.includes(invariant)) {
    failures.push(`register.ts: missing anti-enumeration invariant ${invariant}`);
  }
}
if (
  registerUseCase.includes("prepareSession(") ||
  registerUseCase.includes("issueAccessToken(") ||
  !readFileSync("apps/api/src/http/routes/auth.ts", "utf8").includes(
    "return context.json({ data: pending }, 201)",
  )
) {
  failures.push(
    "register.ts: registration must return a token-free neutral result without a session cookie",
  );
}
if (
  !loginUseCase.includes("DUMMY_PASSWORD_HASH") ||
  !loginUseCase.includes("user?.passwordHash ?? DUMMY_PASSWORD_HASH") ||
  !loginUseCase.includes("rehashPasswordIfUnchanged")
) {
  failures.push(
    "login.ts: auth must retain the dummy KDF and compare-and-swap legacy rehash",
  );
}
for (const path of [
  "apps/frontend/src/pages/auth/SignUp.tsx",
  "apps/app/app/(auth)/sign-up.tsx",
]) {
  const signUpScreen = readFileSync(path, "utf8");
  if (signUpScreen.includes("An account with this email already exists")) {
    failures.push(`${path}: signup must not expose an account-existence branch`);
  }
  if (
    signUpScreen.includes("At least 8 characters") ||
    !signUpScreen.includes("MIN_PASSWORD_LENGTH")
  ) {
    failures.push(`${path}: signup copy must follow the shared password minimum`);
  }
  if (
    signUpScreen.includes("adoptSession(") ||
    (path.startsWith("apps/frontend/") &&
      !signUpScreen.includes("state: { email: pending.email }")) ||
    (path.startsWith("apps/app/") &&
      !signUpScreen.includes("setPendingRegistrationEmail(pending.email)"))
  ) {
    failures.push(`${path}: signup must keep pending registration token-free`);
  }
}
const frontendRoutes = readFileSync("apps/frontend/src/App.tsx", "utf8");
const publicPendingRoute =
  '<Route element={<VerifyPending />} path="/verify-pending" />';
if (
  frontendRoutes.split(publicPendingRoute).length - 1 !== 1 ||
  frontendRoutes.indexOf(publicPendingRoute) >
    frontendRoutes.indexOf('<Route element={<RequireAuth />}>')
) {
  failures.push(
    "frontend routes: verify-pending must remain public after token-free registration",
  );
}

const paddleWebhook = readFileSync(
  "apps/api/src/application/billing/handle_paddle_webhook.ts",
  "utf8",
);
const paddleReconciliation = readFileSync(
  "apps/api/src/application/billing/reconcile_paddle_credits.ts",
  "utf8",
);
const paddleAdjustment = readFileSync(
  "apps/api/src/application/billing/paddle_adjustment.ts",
  "utf8",
);
const paddleClient = readFileSync(
  "apps/api/src/infrastructure/paddle/client.ts",
  "utf8",
);
for (const invariant of [
  'event.event_type === "adjustment.created"',
  'event.event_type === "adjustment.updated"',
  "Paddle checkout does not match the server intent",
  "paddle_adjustment:${data.id}:approved",
  "toPaddleLedgerAdjustmentAmount",
]) {
  if (!paddleWebhook.includes(invariant)) {
    failures.push(`handle_paddle_webhook.ts: missing credit-accounting invariant ${invariant}`);
  }
}
for (const invariant of [
  "listTopupsNeedingReconciliation",
  "listApprovedAdjustments",
  "markTopupReconciled",
  "continue the batch",
  "throw new AggregateError",
  "toPaddleLedgerAdjustmentAmount",
]) {
  if (!paddleReconciliation.includes(invariant)) {
    failures.push(`reconcile_paddle_credits.ts: missing reconciliation invariant ${invariant}`);
  }
}
for (const invariant of [
  '"chargeback_warning",',
  '"chargeback_warning_reverse",',
  "const magnitudeCents = Math.abs(providerTotalCents)",
  "return -magnitudeCents",
  "return magnitudeCents",
  "Paddle adjustment action is unsupported",
]) {
  if (!paddleAdjustment.includes(invariant)) {
    failures.push(`paddle_adjustment.ts: missing signed-provider-total invariant ${invariant}`);
  }
}
for (const invariant of [
  'order_by: "id[ASC]"',
  'per_page: "50"',
  'headers: { "Skip-Count": "true" }',
]) {
  if (!paddleClient.includes(invariant)) {
    failures.push(`paddle/client.ts: missing ordered reconciliation invariant ${invariant}`);
  }
}

const cryptoSource = readFileSync("apps/api/src/shared/crypto.ts", "utf8");
for (const invariant of [
  "CURRENT_ENCRYPTION_VERSION = 4",
  '"workspace-data-key-wrap"',
  "workspaceDataKeys: WorkspaceDataKeyStore",
  "additionalData: exactBuffer(keyWrapAad(fullContext))",
  "encryptionAad(context, active.id, CURRENT_ENCRYPTION_VERSION)",
]) {
  if (!cryptoSource.includes(invariant)) {
    failures.push(`crypto.ts: missing tenant-envelope invariant ${invariant}`);
  }
}

const passwordConstants = readFileSync(
  "apps/api/src/shared/constants.ts",
  "utf8",
);
const passwordPolicy = readFileSync(
  "apps/api/src/shared/password_policy.ts",
  "utf8",
);
const passwordCorpus = readFileSync(
  "apps/api/src/shared/compromised_password_corpus.ts",
  "utf8",
);
const resetPasswordUseCase = readFileSync(
  "apps/api/src/application/auth/reset_password.ts",
  "utf8",
);
for (const invariant of [
  'PASSWORD_HASH_SCHEME = "pbkdf2-sha256"',
  'PASSWORD_HASH_VERSION = "v1"',
  "PBKDF2_ITERATIONS = 600_000",
  "PBKDF2_MAX_VERIFY_ITERATIONS = 1_200_000",
  "MIN_PASSWORD_LENGTH = 15",
]) {
  if (!passwordConstants.includes(invariant)) {
    failures.push(`password constants: missing KDF/policy invariant ${invariant}`);
  }
}
for (const invariant of [
  'password.normalize("NFC")',
  "parsePasswordHash(stored)",
  'parts[0] === "pbkdf2"',
  "iterations > PBKDF2_MAX_VERIFY_ITERATIONS",
  "!parsed.currentFormat",
]) {
  if (!cryptoSource.includes(invariant)) {
    failures.push(`crypto.ts: missing versioned password invariant ${invariant}`);
  }
}
for (const invariant of [
  "COMPROMISED_PASSWORD_CORPUS",
  "new Set([",
  'password.normalize("NFKC").toLowerCase()',
]) {
  if (!passwordPolicy.includes(invariant)) {
    failures.push(`password policy: missing offline blocklist invariant ${invariant}`);
  }
}
for (const invariant of [
  "1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56",
  "c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0",
  "f30800346bf838c71f9ff849b08d85f0e85821c8afd903b7917e3a7cc30da6ec",
]) {
  if (!passwordCorpus.includes(invariant)) {
    failures.push(`password corpus: missing pinned provenance ${invariant}`);
  }
}
if (!resetPasswordUseCase.includes("newPasswordIssues(input.password)")) {
  failures.push("reset password: use case must enforce the new-password policy");
}
if (!existsSync("apps/api/scripts/benchmark-password-kdf.mjs")) {
  failures.push("password KDF: reproducible benchmark script is missing");
}

const verifyEmailUseCase = readFileSync(
  "apps/api/src/application/auth/verify_email.ts",
  "utf8",
);
const verifyTokenLookup = verifyEmailUseCase.indexOf(".findValidByHash(");
const verifyPasswordCheck = verifyEmailUseCase.indexOf("this.passwordVerifier(");
const verifyTokenConsume = verifyEmailUseCase.indexOf(".consumeValidByHash(");
if (
  verifyTokenLookup < 0 ||
  verifyPasswordCheck <= verifyTokenLookup ||
  verifyTokenConsume <= verifyPasswordCheck ||
  !verifyEmailUseCase.includes('"INVALID_CREDENTIALS"') ||
  !verifyEmailUseCase.includes("currentUser.passwordHash !== user.passwordHash") ||
  !verifyEmailUseCase.includes("refreshTokens.revoke(refreshTokenId, now)")
) {
  failures.push(
    "verify email: live token lookup and password proof must precede atomic consumption",
  );
}
const authRoutesSource = readFileSync(
  "apps/api/src/http/routes/auth.ts",
  "utf8",
);
for (const invariant of [
  "zjson(verifyEmailSchema)",
  "password: existingPasswordSchema",
  "RATE_LIMITS.verify_email",
  "`verify:ip:${",
  "`verify:token:${",
]) {
  if (!authRoutesSource.includes(invariant)) {
    failures.push(`verify email route: missing two-factor/rate invariant ${invariant}`);
  }
}
for (const path of [
  "apps/frontend/src/pages/auth/VerifyEmail.tsx",
  "apps/app/app/verify-email.tsx",
]) {
  const screen = readFileSync(path, "utf8");
  if (
    !screen.includes("verificationPasswordSchema") ||
    !screen.includes("INVALID_CREDENTIALS") ||
    !screen.includes("current-password")
  ) {
    failures.push(`${path}: verification must prompt for the registration password`);
  }
}

const adminAuthRoute = readFileSync(
  "apps/admin/src/server/routes/auth.ts",
  "utf8",
);
const adminSession = readFileSync("apps/admin/src/server/session.ts", "utf8");
const adminSessionStore = readFileSync(
  "apps/admin/src/server/admin_sessions.ts",
  "utf8",
);
const adminRequireSession = readFileSync(
  "apps/admin/src/server/require_session.ts",
  "utf8",
);
const adminAllowlist = readFileSync(
  "apps/admin/src/server/allowlist.ts",
  "utf8",
);
for (const invariant of [
  "emailVerified: z.literal(true)",
  "isAdminUserId(deps.adminUserIds, verdict.userId)",
  'context.get("accessSubject")',
]) {
  if (!adminAuthRoute.includes(invariant)) {
    failures.push(`admin auth: missing verified stable-identity invariant ${invariant}`);
  }
}
if (
  !adminSession.includes('JSON.stringify(["zenguy-admin-session", 1, accessSubject, token])') ||
  !adminRequireSession.includes('context.get("accessSubject")') ||
  !adminSessionStore.includes("sessions.auth_version = users.auth_version") ||
  !adminSessionStore.includes("users.email_verified_at IS NOT NULL")
) {
  failures.push(
    "admin sessions must be opaque, Access-subject-bound, verified and auth-version-revocable",
  );
}
for (const invariant of [
  "const REAL_USER_ID_PATTERN = /^usr_[0-7][0-9a-hjkmnp-tv-z]{25}$/u",
  '!value.startsWith("usr_seed_")',
  "entries.some((entry) => !isRealUserId(entry))",
  "new Set(entries).size !== entries.length",
]) {
  if (!adminAllowlist.includes(invariant)) {
    failures.push(`admin allowlist: missing canonical stable-id invariant ${invariant}`);
  }
}
if (
  !adminApp.includes("const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS)") ||
  (adminApp.match(/adminUserIds,/gu) ?? []).length < 2
) {
  failures.push("admin app: the secret allowlist must be validated once and passed as parsed IDs");
}

const encryptedWriteFencePath =
  "apps/api/migrations/0040_encrypted_write_fence.sql";
const encryptedWriteFence = readFileSync(encryptedWriteFencePath, "utf8");
const encryptedWriteFenceTriggerNames = [
  "trg_workspace_secrets_v4_insert_active_dek",
  "trg_workspace_secrets_v4_update_active_dek",
  "trg_notification_channels_v4_insert_active_dek",
  "trg_notification_channels_v4_update_active_dek",
  "trg_uptime_monitors_v4_headers_insert_active_dek",
  "trg_uptime_monitors_v4_headers_update_active_dek",
  "trg_uptime_monitors_v4_body_insert_active_dek",
  "trg_uptime_monitors_v4_body_update_active_dek",
];
const encryptedWriteFenceTriggers = encryptedWriteFence
  .split(/CREATE TRIGGER\s+/u)
  .slice(1);
if (
  encryptedWriteFenceTriggers.length !==
  encryptedWriteFenceTriggerNames.length
) {
  failures.push(
    `${encryptedWriteFencePath}: exactly eight active-DEK fence triggers are required`,
  );
}
for (const triggerName of encryptedWriteFenceTriggerNames) {
  const trigger = encryptedWriteFenceTriggers.find((candidate) =>
    candidate.startsWith(`${triggerName}\n`),
  );
  if (
    trigger === undefined ||
    !trigger.includes("substr(") ||
    !trigger.includes("<> 'v4:'") ||
    !trigger.includes("k.active = 1") ||
    !trigger.includes(
      "SELECT RAISE(ABORT, 'ZENGUY_STALE_DATA_ENCRYPTION_KEY');",
    )
  ) {
    failures.push(
      `${encryptedWriteFencePath}: ${triggerName} must reject non-v4, use exact active-DEK matching and raise the stale-DEK marker`,
    );
  }
  if (
    triggerName.includes("_update_") &&
    (trigger === undefined ||
      !trigger.includes("UPDATE OF id, workspace_id") ||
      !trigger.includes("NEW.id IS NOT OLD.id") ||
      !trigger.includes("NEW.workspace_id IS NOT OLD.workspace_id"))
  ) {
    failures.push(
      `${encryptedWriteFencePath}: ${triggerName} must make AAD-bound record/workspace identity immutable`,
    );
  }
}
for (const secretTriggerName of [
  "trg_workspace_secrets_v4_insert_active_dek",
  "trg_workspace_secrets_v4_update_active_dek",
]) {
  const trigger = encryptedWriteFenceTriggers.find((candidate) =>
    candidate.startsWith(`${secretTriggerName}\n`),
  );
  if (
    trigger === undefined ||
    !trigger.includes("encryption_version") ||
    !trigger.includes("NEW.encryption_version <> 4")
  ) {
    failures.push(
      `${encryptedWriteFencePath}: ${secretTriggerName} must bind encryption_version=4 to v4 writes`,
    );
  }
}
if (/\bLIKE\b/iu.test(encryptedWriteFence)) {
  failures.push(
    `${encryptedWriteFencePath}: LIKE is forbidden because DEK ids may contain SQL wildcard characters`,
  );
}

const adminWranglerConfig = readFileSync("apps/admin/wrangler.jsonc", "utf8");
if (
  !/"compatibility_flags"\s*:\s*\[\s*"nodejs_compat"\s*,\s*"global_fetch_strictly_public"\s*\]/u.test(
    adminWranglerConfig,
  )
) {
  failures.push(
    "apps/admin/wrangler.jsonc: admin subrequests must traverse the public zone security pipeline",
  );
}
function adminConfigString(name) {
  const matches = [
    ...adminWranglerConfig.matchAll(
      new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, "gu"),
    ),
  ];
  if (matches.length !== 1) {
    failures.push(`apps/admin/wrangler.jsonc: ${name} must be one non-secret var`);
    return null;
  }
  return matches[0][1];
}
const accessTeamDomain = adminConfigString("CF_ACCESS_TEAM_DOMAIN");
if (accessTeamDomain !== null) {
  try {
    const parsed = new URL(accessTeamDomain);
    if (
      parsed.origin !== accessTeamDomain ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/u.test(
        parsed.hostname,
      ) ||
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error("invalid Access origin");
    }
  } catch {
    failures.push(
      "apps/admin/wrangler.jsonc: CF_ACCESS_TEAM_DOMAIN must be an exact HTTPS *.cloudflareaccess.com origin",
    );
  }
}
const accessAudience = adminConfigString("CF_ACCESS_AUD");
if (
  accessAudience !== null &&
  !/^[A-Za-z0-9_-]{16,}$/u.test(accessAudience)
) {
  failures.push(
    "apps/admin/wrangler.jsonc: CF_ACCESS_AUD must be a non-empty Access audience of at least 16 characters",
  );
}
const adminVarsIndex = adminWranglerConfig.indexOf('"vars"');
for (const name of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD"]) {
  if (
    adminVarsIndex === -1 ||
    adminWranglerConfig.indexOf(`"${name}"`, adminVarsIndex) === -1 ||
    adminWranglerConfig.includes(`wrangler secret put ${name}`)
  ) {
    failures.push(
      `apps/admin/wrangler.jsonc: ${name} must remain a reviewed non-secret var`,
    );
  }
}
if (
  !/"secrets"\s*:\s*\{\s*"required"\s*:\s*\[\s*"ADMIN_USER_IDS"\s*\]\s*\}/u.test(
    adminWranglerConfig,
  ) ||
  /"ADMIN_USER_IDS"\s*:/u.test(adminWranglerConfig)
) {
  failures.push(
    "apps/admin/wrangler.jsonc: ADMIN_USER_IDS must be the sole required secret and never a versioned var",
  );
}

const adminManifest = JSON.parse(readFileSync("apps/admin/package.json", "utf8"));
const adminScripts = adminManifest.scripts ?? {};
const adminTsconfig = JSON.parse(readFileSync("apps/admin/tsconfig.json", "utf8"));
if (
  adminScripts.typecheck !==
    "wrangler types --check && tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.client.json" ||
  !adminTsconfig.include?.includes("worker-configuration.d.ts") ||
  adminTsconfig.compilerOptions?.types?.includes("@cloudflare/workers-types") ||
  Object.hasOwn(adminManifest.dependencies ?? {}, "@cloudflare/workers-types") ||
  Object.hasOwn(adminManifest.devDependencies ?? {}, "@cloudflare/workers-types") ||
  !readFileSync("apps/admin/worker-configuration.d.ts", "utf8").startsWith(
    "/* eslint-disable */\n// Generated by Wrangler",
  )
) {
  failures.push(
    "apps/admin: Worker bindings/runtime types must be generated by Wrangler and checked before TypeScript",
  );
}
for (const [name, expected] of [
  ["test:preflight", "node --test scripts/verify-remote-secrets.test.mjs"],
  ["deploy:preflight", "node scripts/verify-remote-secrets.mjs"],
  ["deploy", "pnpm build && pnpm deploy:preflight && wrangler deploy"],
]) {
  if (adminScripts[name] !== expected) {
    failures.push(`apps/admin/package.json: ${name} must preserve the protected admin deploy`);
  }
}
const adminRemoteSecretPreflight = readFileSync(
  "apps/admin/scripts/verify-remote-secrets.mjs",
  "utf8",
);
for (const invariant of [
  'Object.freeze(["ADMIN_USER_IDS"])',
  '"secret",',
  '"list",',
  '"--config",',
  '"wrangler.jsonc",',
  '"--format",',
  '"json",',
  'Object.hasOwn(binding, "value")',
  'Object.hasOwn(binding, "text")',
  'Object.hasOwn(binding, "key_base64")',
  'Object.hasOwn(binding, "key_jwk")',
  'binding.type !== "secret_text"',
  "new Set(parsed.map(({ name }) => name)).size !== parsed.length",
  'stdio: ["ignore", "pipe", "inherit"]',
]) {
  if (!adminRemoteSecretPreflight.includes(invariant)) {
    failures.push(`admin secret preflight: missing metadata-only invariant ${invariant}`);
  }
}
if (
  adminRemoteSecretPreflight.includes("readFileSync") ||
  adminRemoteSecretPreflight.includes("secret put") ||
  adminRemoteSecretPreflight.includes("binding.value")
) {
  failures.push("admin secret preflight: secret values and mutating operations are forbidden");
}
for (const path of [
  "apps/admin/src/test/fakes.ts",
  "apps/admin/vitest.integration.config.ts",
  "apps/api/scripts/seed.mjs",
]) {
  if (readFileSync(path, "utf8").includes("usr_seed_")) {
    failures.push(`${path}: runtime fixtures must use canonical usr_<ULID> ids`);
  }
}
const adminFakeBindings = readFileSync("apps/admin/src/test/fakes.ts", "utf8");
const canonicalFixturePattern = /usr_[0-7][0-9a-hjkmnp-tv-z]{25}/gu;
if ((adminFakeBindings.match(canonicalFixturePattern) ?? []).length < 2) {
  failures.push("apps/admin/src/test/fakes.ts: admin identities must use valid-format user IDs");
}

const codeowners = readFileSync(".github/CODEOWNERS", "utf8")
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));
const requiredCodeownerTail = [
  "/.github/workflows/ @maguayo",
  "/.github/CODEOWNERS @maguayo",
  "/apps/api/migrations/ @maguayo",
  "/apps/api/scripts/ @maguayo",
  "/apps/api/wrangler.jsonc @maguayo",
  "/apps/api/wrangler.production-bootstrap.jsonc @maguayo",
  "/apps/admin/scripts/ @maguayo",
  "/apps/admin/wrangler.jsonc @maguayo",
  "/runner/ @maguayo",
  "/scripts/security/ @maguayo",
  "/security/ @maguayo",
  "/SECURITY.md @maguayo",
];
if (
  codeowners.length < requiredCodeownerTail.length ||
  codeowners
    .slice(-requiredCodeownerTail.length)
    .some((line, index) => line !== requiredCodeownerTail[index])
) {
  failures.push(
    ".github/CODEOWNERS: security-sensitive ownership rules must remain the final precedence block",
  );
}
const workflowPaths = readdirSync(".github/workflows")
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => `.github/workflows/${name}`)
  .sort();
for (const path of workflowPaths) {
  const workflow = readFileSync(path, "utf8");
  if (/runs-on:\s*ubuntu-latest/u.test(workflow)) {
    failures.push(`${path}: Linux runner image must not use the rolling ubuntu-latest label`);
  }
  if (/^\s*pull_request_target\s*:/mu.test(workflow)) {
    failures.push(`${path}: pull_request_target is forbidden for repository code`);
  }
  if (
    path !== ".github/workflows/runner-images.yml" &&
    /^(?:\s+)(?:packages|id-token):\s*write\s*$/mu.test(workflow)
  ) {
    failures.push(
      `${path}: registry or OIDC write permission is reserved for the runner release job`,
    );
  }
  for (const line of workflow.split(/\r?\n/u)) {
    const match = line.match(/^\s*-?\s*uses:\s+([^\s]+)$/u);
    if (
      match !== null &&
      !match[1].startsWith("./") &&
      !/@[0-9a-f]{40}$/u.test(match[1])
    ) {
      failures.push(`${path}: external action must be pinned by commit (${match[1]})`);
    }
  }
}
for (const path of [
  ".github/workflows/production.yml",
  ".github/workflows/staging.yml",
  ".github/workflows/security.yml",
  ".github/workflows/ios-release.yml",
  ".github/workflows/ios-ota.yml",
]) {
  if (!readFileSync(path, "utf8").includes(`node-version: ${pinnedNode}`)) {
    failures.push(`${path}: CI Node runtime must exactly match .node-version (${pinnedNode})`);
  }
}
const iosReleaseWorkflow = readFileSync(
  ".github/workflows/ios-release.yml",
  "utf8",
);
for (const invariant of [
  'tags:\n      - "ios-v*"',
  "github.repository == 'maguayo/zenguy'",
  "github.ref_type == 'tag'",
  "name: ios-production-release",
  "fetch-depth: 0",
  'node apps/app/scripts/verify-release-tag.mjs release "$GITHUB_REF_NAME"',
  'git rev-list -n 1 "$GITHUB_SHA"',
  'gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha',
  "pnpm install --frozen-lockfile",
  "pnpm exec expo install --check",
  "pnpm exec expo-doctor",
  'ZENGUY_ENFORCE_TRACKED_RELEASE_ARTIFACTS: "1"',
  "pnpm verify:release-config",
  "secrets.EXPO_IOS_RELEASE_TOKEN",
  "pnpm exec eas build",
  "--freeze-credentials",
]) {
  if (!iosReleaseWorkflow.includes(invariant)) {
    failures.push(
      `.github/workflows/ios-release.yml: missing release invariant ${invariant}`,
    );
  }
}
if (
  (iosReleaseWorkflow.match(/git\/ref\/heads\/main/gu) ?? []).length < 2 ||
  iosReleaseWorkflow.includes("secrets.EXPO_TOKEN")
) {
  failures.push(
    ".github/workflows/ios-release.yml: current-main must be re-fenced before its dedicated release credential",
  );
}

const iosOtaWorkflow = readFileSync(
  ".github/workflows/ios-ota.yml",
  "utf8",
);
for (const [path, source] of [
  [".github/workflows/ios-release.yml", iosReleaseWorkflow],
  [".github/workflows/ios-ota.yml", iosOtaWorkflow],
  ["apps/app/README.md", readFileSync("apps/app/README.md", "utf8")],
]) {
  if (/\bnpx(?:\s+--yes)?\s+eas-cli(?:@|\s)/u.test(source)) {
    failures.push(`${path}: EAS must execute from the frozen app lockfile`);
  }
}
for (const invariant of [
  'tags:\n      - "ios-ota-v*"',
  "github.repository == 'maguayo/zenguy'",
  "github.ref_type == 'tag'",
  "name: ios-production-ota",
  "fetch-depth: 0",
  'node apps/app/scripts/verify-release-tag.mjs ota "$GITHUB_REF_NAME"',
  'git rev-list -n 1 "$GITHUB_SHA"',
  'gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha',
  "pnpm install --frozen-lockfile",
  "pnpm exec expo install --check",
  "pnpm exec expo-doctor",
  "EAS_BUILD_PROFILE: production",
  'ZENGUY_ENFORCE_TRACKED_RELEASE_ARTIFACTS: "1"',
  "pnpm verify:release-config",
  "secrets.EXPO_IOS_OTA_TOKEN",
  "EAS_UPDATE_PRIVATE_KEY_PEM",
  "openssl x509",
  "cmp --silent",
  "pnpm exec eas update",
  "--private-key-path",
  "if: always()",
]) {
  if (!iosOtaWorkflow.includes(invariant)) {
    failures.push(
      `.github/workflows/ios-ota.yml: missing signed OTA invariant ${invariant}`,
    );
  }
}
if (
  (iosOtaWorkflow.match(/git\/ref\/heads\/main/gu) ?? []).length < 3 ||
  iosOtaWorkflow.includes("secrets.EXPO_TOKEN")
) {
  failures.push(
    ".github/workflows/ios-ota.yml: current-main must be fenced before both isolated OTA credentials",
  );
}

const releaseTagGuard = readFileSync(
  "apps/app/scripts/verify-release-tag.mjs",
  "utf8",
);
for (const invariant of [
  "ios-v${version}",
  "ios-ota-v${version}-<positive sequence>",
  "[1-9]\\\\d*",
  'readFileSync(new URL("../package.json", import.meta.url)',
]) {
  if (!releaseTagGuard.includes(invariant)) {
    failures.push(
      `apps/app/scripts/verify-release-tag.mjs: missing exact-version tag invariant ${invariant}`,
    );
  }
}

const easConfig = JSON.parse(readFileSync("apps/app/eas.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/u.test(easConfig.cli?.version ?? "")) {
  failures.push("apps/app/eas.json: EAS CLI must be pinned to an exact version");
}
if (easConfig.cli?.requireCommit !== true) {
  failures.push("apps/app/eas.json: EAS builds must require a clean commit");
}
for (const profile of ["development", "preview", "production"]) {
  if (easConfig.build?.[profile]?.node !== pinnedNode) {
    failures.push(
      `apps/app/eas.json: ${profile} Node runtime must exactly match .node-version (${pinnedNode})`,
    );
  }
  if (
    easConfig.build?.[profile]?.ios?.image !==
    "macos-tahoe-26.5-xcode-26.6"
  ) {
    failures.push(
      `apps/app/eas.json: ${profile} iOS build image must be pinned exactly`,
    );
  }
}
if (
  easConfig.build?.production?.environment !== "production" ||
  easConfig.build?.production?.channel !== "production" ||
  easConfig.build?.production?.autoIncrement !== true
) {
  failures.push(
    "apps/app/eas.json: production must use its production environment/channel and auto-increment",
  );
}

const expoConfig = readFileSync("apps/app/app.config.ts", "utf8");
if (
  !expoConfig.includes('codeSigningCertificate: "./certs/updates-certificate.pem"') ||
  !expoConfig.includes('alg: "rsa-v1_5-sha256"') ||
  !expoConfig.includes('runtimeVersion: { policy: "fingerprint" }')
) {
  failures.push("apps/app/app.config.ts: signed fingerprint-scoped OTA updates are required");
}
if (
  !expoConfig.includes('associatedDomains: ["applinks:app.zenguy.com"]') ||
  /\bscheme\s*:/u.test(expoConfig) ||
  !expoConfig.includes('"aps-environment": isProductionProfile ? "production" : "development"') ||
  !expoConfig.includes('"./plugins/with-universal-links-only"')
) {
  failures.push(
    "apps/app/app.config.ts: require the HTTPS Universal Link entitlement and no custom URL scheme",
  );
}
const universalLinksOnlyPlugin = readFileSync(
  "apps/app/plugins/with-universal-links-only.js",
  "utf8",
);
if (
  !universalLinksOnlyPlugin.includes("delete next.modResults.CFBundleURLTypes")
) {
  failures.push(
    "with-universal-links-only.js: generated iOS custom schemes must be removed",
  );
}
const aasa = JSON.parse(
  readFileSync(
    "apps/frontend/public/.well-known/apple-app-site-association",
    "utf8",
  ),
);
const expectedAasaPaths = [
  "/verify-email",
  "/reset-password",
  "/invitations/*",
  "/grants/*",
  "/w/*",
];
const modernAasaDetail = aasa.applinks?.details?.find(
  (detail) => detail.appIDs?.includes("HT84Q65URB.com.zenguy.app"),
);
const legacyAasaDetail = aasa.applinks?.details?.find(
  (detail) => detail.appID === "HT84Q65URB.com.zenguy.app",
);
if (
  JSON.stringify(modernAasaDetail?.components?.map((component) => component["/"])) !==
    JSON.stringify(expectedAasaPaths) ||
  JSON.stringify(legacyAasaDetail?.paths) !== JSON.stringify(expectedAasaPaths)
) {
  failures.push(
    "apple-app-site-association: modern and legacy rules must exactly allow the reviewed routes",
  );
}
if (
  !readFileSync("apps/frontend/index.html", "utf8").includes(
    '<meta name="referrer" content="no-referrer" />',
  )
) {
  failures.push(
    "apps/frontend/index.html: capability links need a no-referrer meta fallback",
  );
}

const emailTemplates = readFileSync(
  "apps/api/src/infrastructure/email/templates.ts",
  "utf8",
);
const grantIssuer = readFileSync(
  "apps/api/src/application/billing/issue_subscription_grant.ts",
  "utf8",
);
if (
  !emailTemplates.includes('/${path}#${encodeURIComponent(token)}') ||
  !emailTemplates.includes('/invitations/accept#${encodeURIComponent(token)}') ||
  emailTemplates.includes("?token=${encodeURIComponent(token)}") ||
  !grantIssuer.includes("/grants/redeem#${encodeURIComponent(token)}")
) {
  failures.push(
    "capability links: newly issued auth, invitation and grant bearers must stay in URL fragments",
  );
}
for (const path of [
  "apps/frontend/src/api/invitations.ts",
  "apps/app/src/api/invitations.ts",
]) {
  const client = readFileSync(path, "utf8");
  if (
    !client.includes('apiPost("/api/invitations/preview", { token })') ||
    !client.includes('apiPost("/api/invitations/accept", { token })') ||
    client.includes("encodeURIComponent(token)")
  ) {
    failures.push(`${path}: invitation bearer must travel only in POST bodies`);
  }
}
for (const path of [
  "apps/frontend/src/api/grants.ts",
  "apps/app/src/api/grants.ts",
]) {
  const client = readFileSync(path, "utf8");
  if (
    !client.includes('apiPost("/api/subscription-grants/preview", { token })') ||
    !client.includes('apiPost("/api/subscription-grants/redeem", { token, workspaceId })') ||
    client.includes("encodeURIComponent(token)")
  ) {
    failures.push(`${path}: grant bearer must travel only in POST bodies`);
  }
}
for (const [path, invariants] of [
  [
    "apps/app/app/invitations/[token].tsx",
    ['captureLinkCapability("invitation"', "Linking.clearInitialURL()", 'router.replace("/invitations/accept")'],
  ],
  [
    "apps/app/app/grants/[token].tsx",
    ['captureLinkCapability("grant"', "Linking.clearInitialURL()", 'router.replace("/grants/redeem")'],
  ],
  [
    "apps/app/app/verify-email.tsx",
    ['captureLinkCapability("verification"', "Linking.clearInitialURL()", 'router.replace("/verify-email")'],
  ],
  [
    "apps/app/app/(auth)/reset-password.tsx",
    ['captureLinkCapability("password-reset"', "Linking.clearInitialURL()", 'router.replace("/(auth)/reset-password")'],
  ],
]) {
  const route = readFileSync(path, "utf8");
  for (const invariant of invariants) {
    if (!route.includes(invariant)) {
      failures.push(`${path}: missing bearer cleanup invariant ${invariant}`);
    }
  }
}
const productionWorkflow = readFileSync(".github/workflows/production.yml", "utf8");
if (
  !productionWorkflow.includes("uses: ./.github/workflows/security.yml") ||
  !productionWorkflow.includes("needs: security-gates")
) {
  failures.push("production.yml: deployment must depend on the reusable security gates");
}
if (
  (productionWorkflow.match(/if: github\.ref == 'refs\/heads\/main'/gu) ?? [])
    .length < 2 ||
  !productionWorkflow.includes("fetch-depth: 0") ||
  (productionWorkflow.match(/git\/ref\/heads\/main/gu) ?? []).length < 2 ||
  (productionWorkflow.match(/test "\$GITHUB_SHA" = "\$current_sha"/gu) ?? [])
    .length < 2
) {
  failures.push(
    "production.yml: secret-bearing jobs must be pinned and re-fenced to the current main head",
  );
}
if (
  !productionWorkflow.includes("environment:\n      name: production") ||
  productionWorkflow.includes("secrets.CLOUDFLARE_API_TOKEN") ||
  productionWorkflow.includes("secrets.CLOUDFLARE_STAGING_API_TOKEN") ||
  (productionWorkflow.match(/secrets\.CLOUDFLARE_PRODUCTION_API_TOKEN/gu) ?? [])
    .length !== 6
) {
  failures.push(
    "production.yml: production must use only its protected Environment and dedicated Cloudflare token",
  );
}
const productionPreflight = productionWorkflow.indexOf(
  "run: pnpm deploy:preflight:production",
);
const productionMigration = productionWorkflow.indexOf(
  "run: pnpm db:migrate:production",
);
const productionKmsDeploy = productionWorkflow.indexOf(
  "run: pnpm deploy:kms:production",
);
if (
  productionPreflight === -1 ||
  productionKmsDeploy === -1 ||
  productionMigration === -1 ||
  productionPreflight >= productionKmsDeploy ||
  productionKmsDeploy >= productionMigration
) {
  failures.push(
    "production.yml: bindings must be verified before the private KMS deploy and D1 migration",
  );
}
const productionApiDeploy = productionWorkflow.indexOf(
  "run: pnpm deploy:production",
);
const productionAdminFence = productionWorkflow.indexOf(
  "Verify production commit before admin deploy",
);
const productionAdminPreflight = productionWorkflow.indexOf(
  "Verify required production admin Worker secrets",
);
const productionAdminDeploy = productionWorkflow.indexOf(
  "Deploy production admin Worker",
);
if (
  productionApiDeploy === -1 ||
  productionAdminFence <= productionApiDeploy ||
  productionAdminPreflight <= productionAdminFence ||
  productionAdminDeploy <= productionAdminPreflight ||
  !productionWorkflow.slice(productionAdminPreflight, productionAdminDeploy).includes(
    "working-directory: apps/admin",
  ) ||
  !productionWorkflow.slice(productionAdminPreflight, productionAdminDeploy).includes(
    "run: pnpm deploy:preflight",
  ) ||
  !productionWorkflow.slice(productionAdminDeploy).includes(
    "working-directory: apps/admin",
  ) ||
  !productionWorkflow.slice(productionAdminDeploy).includes("run: pnpm deploy")
) {
  failures.push(
    "production.yml: the tested admin Worker must deploy only after migration, API deploy and a fresh main-head fence",
  );
}

const stagingWorkflow = readFileSync(".github/workflows/staging.yml", "utf8");
if (
  !stagingWorkflow.includes("uses: ./.github/workflows/security.yml") ||
  !stagingWorkflow.includes("needs: security-gates")
) {
  failures.push("staging.yml: deployment must depend on the reusable security gates");
}
if (
  !stagingWorkflow.includes("environment:\n      name: staging") ||
  stagingWorkflow.includes("secrets.CLOUDFLARE_API_TOKEN") ||
  stagingWorkflow.includes("secrets.CLOUDFLARE_PRODUCTION_API_TOKEN") ||
  (stagingWorkflow.match(/secrets\.CLOUDFLARE_STAGING_API_TOKEN/gu) ?? [])
    .length !== 4
) {
  failures.push(
    "staging.yml: staging must use only its protected Environment and dedicated Cloudflare token",
  );
}
if (
  !stagingWorkflow.includes("group: staging-deploy") ||
  (stagingWorkflow.match(/if: github\.ref == 'refs\/heads\/staging'/gu) ?? [])
    .length < 2 ||
  !stagingWorkflow.includes("fetch-depth: 0") ||
  (stagingWorkflow.match(/git\/ref\/heads\/staging/gu) ?? []).length < 2 ||
  (stagingWorkflow.match(/test "\$GITHUB_SHA" = "\$current_sha"/gu) ?? [])
    .length < 2
) {
  failures.push(
    "staging.yml: deploys must serialize and remain pinned to the current staging head",
  );
}
const stagingTestCommands = [
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:integration",
  "pnpm typecheck",
  "pnpm test",
  "pnpm test:integration",
];
let stagingCursor = 0;
for (const command of stagingTestCommands) {
  const index = stagingWorkflow.indexOf(`run: ${command}`, stagingCursor);
  if (index === -1) {
    failures.push(`staging.yml: missing pre-deploy validation command ${command}`);
    break;
  }
  stagingCursor = index + command.length;
}
const stagingMigration = stagingWorkflow.indexOf("run: pnpm db:migrate:staging");
const stagingDeploy = stagingWorkflow.indexOf("run: pnpm deploy:staging");
const stagingPreflight = stagingWorkflow.indexOf(
  "run: pnpm deploy:preflight:staging",
);
const stagingKmsDeploy = stagingWorkflow.indexOf(
  "run: pnpm deploy:kms:staging",
);
if (
  stagingPreflight === -1 ||
  stagingKmsDeploy === -1 ||
  stagingMigration === -1 ||
  stagingDeploy === -1 ||
  stagingCursor >= stagingPreflight ||
  stagingPreflight >= stagingKmsDeploy ||
  stagingKmsDeploy >= stagingMigration ||
  stagingMigration >= stagingDeploy
) {
  failures.push(
    "staging.yml: tests and secret preflight must pass before migration and deployment",
  );
}

const expectedDockerIgnores = new Map([
  [
    "runner/.dockerignore",
    "**\n!browser_worker.py\n!requirements.lock\n!deploy\n!deploy/Dockerfile",
  ],
  [
    "runner/deploy/.dockerignore",
    "**\n!egress-proxy.Dockerfile\n!squid.conf\n!host-egress-deny.build.conf",
  ],
]);
for (const [path, expected] of expectedDockerIgnores) {
  if (readFileSync(path, "utf8").trim() !== expected) {
    failures.push(`${path}: Docker build context allowlist changed unexpectedly`);
  }
}
for (const path of [
  "runner/deploy/Dockerfile",
  "runner/deploy/egress-proxy.Dockerfile",
]) {
  const dockerfile = readFileSync(path, "utf8");
  if (
    !/^FROM .+@sha256:[0-9a-f]{64}$/mu.test(dockerfile) ||
    !dockerfile.includes("https://snapshot.debian.org/archive/") ||
    dockerfile.includes("http://snapshot.debian.org/archive/")
  ) {
    failures.push(
      `${path}: base digest and TLS-authenticated immutable Debian snapshot are required`,
    );
  }
}
const egressProxyDockerfile = readFileSync(
  "runner/deploy/egress-proxy.Dockerfile",
  "utf8",
);
if (
  !egressProxyDockerfile.includes(
    "FROM python:3.12.14-slim-bookworm@sha256:a116514e19457bcb7af7efe9c3dd0b9b71e85b317694e7882a1c52aa15a78134 AS certificates",
  ) ||
  !egressProxyDockerfile.includes(
    "COPY --from=certificates /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt",
  )
) {
  failures.push(
    "runner/deploy/egress-proxy.Dockerfile: HTTPS snapshot bootstrap must use the pinned CA bundle",
  );
}
const runnerDockerfile = readFileSync("runner/deploy/Dockerfile", "utf8");
if (
  !runnerDockerfile.includes("--no-deps --only-binary=:all: --require-hashes") ||
  !runnerDockerfile.includes(
    "test -s /etc/ssl/certs/ca-certificates.crt",
  )
) {
  failures.push(
    "runner/deploy/Dockerfile: HTTPS snapshot bootstrap and hashed wheels-only Python install are required",
  );
}
if (
  !egressProxyDockerfile.includes(
    "squid -k parse",
  ) ||
  !egressProxyDockerfile.includes(
    "COPY host-egress-deny.build.conf /etc/squid/host-egress-deny.conf",
  )
) {
  failures.push("runner/deploy/egress-proxy.Dockerfile: Squid policy must parse during the image build");
}
const runnerCompose = readFileSync("runner/deploy/compose.yml", "utf8");
const runnerSeccompPath =
  "runner/deploy/seccomp/chromium-moby-v0.2.1.json";
const runnerSeccompDigest =
  "c5ce0008dc103f3edf0d9f406c6fccb4f17f5cb7be25c05a9e691b927f69ca6e";
if (!existsSync(runnerSeccompPath)) {
  failures.push(`${runnerSeccompPath}: reviewed seccomp profile is missing`);
} else {
  const runnerSeccomp = readFileSync(runnerSeccompPath);
  const actualDigest = createHash("sha256").update(runnerSeccomp).digest("hex");
  if (actualDigest !== runnerSeccompDigest) {
    failures.push(`${runnerSeccompPath}: reviewed seccomp digest changed`);
  }
  const runnerSeccompText = runnerSeccomp.toString("utf8");
  try {
    const profile = JSON.parse(runnerSeccompText);
    if (profile.defaultAction !== "SCMP_ACT_ERRNO") {
      failures.push(`${runnerSeccompPath}: default action must fail closed`);
    }
    const chromiumNamespaceRule = profile.syscalls?.some(
      (rule) =>
        rule.action === "SCMP_ACT_ALLOW" &&
        rule.args === undefined &&
        rule.includes === undefined &&
        rule.excludes === undefined &&
        rule.names?.includes("clone") &&
        rule.names?.includes("unshare"),
    );
    if (!chromiumNamespaceRule) {
      failures.push(
        `${runnerSeccompPath}: Chromium sandbox requires the reviewed clone/unshare namespace rule`,
      );
    }
  } catch {
    failures.push(`${runnerSeccompPath}: profile must be valid JSON`);
  }
  if (runnerSeccompText.includes('"socketcall"')) {
    failures.push(`${runnerSeccompPath}: socketcall compatibility path is forbidden`);
  }
}
for (const invariant of [
  "image: ${ZENGUY_RUNNER_IMAGE:?",
  "image: ${ZENGUY_EGRESS_PROXY_IMAGE:?",
  "ZENGUY_RUNNER_ENVIRONMENT: ${ZENGUY_RUNNER_ENVIRONMENT:-production}",
  "seccomp=/opt/zenguy/runner/deploy/seccomp/chromium-moby-v0.2.1.json",
  "com.docker.network.bridge.gateway_mode_ipv4: isolated",
  'ZENGUY_ISOLATED_RUNNER: "1"',
  'user: "10001:10001"',
  'user: "13:13"',
  'cap_drop: ["ALL"]',
  "no-new-privileges:true",
  "read_only: true",
  "pids_limit:",
  "mem_limit:",
  "cpus:",
  'restart: "no"',
  "ZENGUY_HOST_EGRESS_DENY_FILE:?",
  "create_host_path: false",
]) {
  if (!runnerCompose.includes(invariant)) {
    failures.push(`runner/deploy/compose.yml: missing immutable runtime invariant ${invariant}`);
  }
}
if ((runnerCompose.match(/^\s+cpus:/gmu) ?? []).length !== 2) {
  failures.push("runner/deploy/compose.yml: both containers require CPU limits");
}
if (/^\s+build:/mu.test(runnerCompose)) {
  failures.push("runner/deploy/compose.yml: production runtime must not contain build contexts");
}
for (const forbidden of [
  /^\s+privileged:\s*true\s*$/mu,
  /^\s+cap_add:/mu,
  /SYS_ADMIN/u,
  /seccomp=unconfined/u,
  /apparmor=unconfined/u,
  /^\s+network_mode:\s*host\s*$/mu,
  /^\s+pid:\s*host\s*$/mu,
  /^\s+ipc:\s*host\s*$/mu,
  /docker\.sock/u,
]) {
  if (forbidden.test(runnerCompose)) {
    failures.push(`runner/deploy/compose.yml: forbidden container escape setting ${forbidden}`);
  }
}

const runnerService = readFileSync(
  "runner/deploy/zenguy-fallback.service",
  "utf8",
);
if (/ZENGUY_CHROMIUM_SECCOMP_(?:PROFILE|SHA256)/u.test(runnerService)) {
  failures.push(
    "zenguy-fallback.service: mutable seccomp path or digest overrides are forbidden",
  );
}
for (const invariant of [
  "verify-runtime-images.sh",
  "verify-container-runtime.sh",
  "EnvironmentFile=/etc/zenguy/fallback.runtime.env",
  "LoadCredential=fallback.env:/etc/zenguy/fallback.env",
  "Environment=ZENGUY_RUNNER_ENV_FILE=%d/fallback.env",
  "docker rm --force zenguy-fallback-attempt",
  "docker rm --force zenguy-fallback-sandbox-preflight",
  "--project-name zenguy-fallback",
  " pull --quiet runner egress-proxy",
  "ZENGUY_RUNNER_ENV_FILE=/dev/null /usr/bin/docker compose",
  " run --name zenguy-fallback-sandbox-preflight --rm --no-deps runner --verify-browser-sandbox",
  " up --detach --no-build --remove-orphans egress-proxy",
  " run --name zenguy-fallback-attempt --rm --no-deps runner",
]) {
  if (!runnerService.includes(invariant)) {
    failures.push(`zenguy-fallback.service: missing isolated runtime invariant ${invariant}`);
  }
}
if (
  /(?:^|\n)(?:Group|SupplementaryGroups)=.*\bdocker\b/mu.test(runnerService) ||
  /(?:^|\n)Exec(?:Start|StartPre|StartPost|Stop|StopPost)=\/?usr\/bin\/docker\b/mu.test(runnerService)
) {
  failures.push(
    "zenguy-fallback.service: the service user must not receive Docker-daemon privileges",
  );
}
for (const line of runnerService.split(/\r?\n/u)) {
  if (
    /^Exec(?:Start|StartPre|StartPost|Stop|StopPost)=/u.test(line) &&
    line.includes("/usr/bin/docker compose") &&
    !/^Exec(?:Start|StartPre|StartPost|Stop|StopPost)=\+/u.test(line)
  ) {
    failures.push(
      "zenguy-fallback.service: only fixed root-prefixed Compose commands may reach the Docker daemon",
    );
  }
}
if (
  (runnerService.match(/docker rm --force zenguy-fallback-attempt/gu) ?? [])
    .length < 2
) {
  failures.push(
    "zenguy-fallback.service: both start and stop must reap an ambiguous attempt container",
  );
}
if (
  !runnerService.includes(
    "ExecStopPost=-+/usr/bin/docker rm --force zenguy-fallback-attempt",
  ) ||
  !runnerService.includes(
    "ExecStopPost=-+/usr/bin/docker rm --force zenguy-fallback-sandbox-preflight",
  )
) {
  failures.push(
    "zenguy-fallback.service: unconditional post-stop cleanup must reap both fixed containers",
  );
}

const containerRuntimeVerifier = readFileSync(
  "runner/deploy/verify-container-runtime.sh",
  "utf8",
);
for (const invariant of [
  'version_at_least "$docker_server_version" "28.0.0"',
  'version_at_least "$compose_version" "2.33.1"',
  '"SCMP_ACT_ERRNO"',
  'profile=/opt/zenguy/runner/deploy/seccomp/chromium-moby-v0.2.1.json',
  `expected_sha=${runnerSeccompDigest}`,
  '"socketcall"',
  'ZENGUY_HOST_EGRESS_DENY_FILE must be /etc/zenguy/host-egress-deny.conf',
  'ip -o -4 address show scope global',
  'ip -o -6 address show scope global',
  'host egress denylist omits interface address',
  'require_root_directory "/etc/zenguy"',
  'require_root_directory "/opt/zenguy"',
  'require_root_directory "$deploy_root/deploy"',
  '/run/credentials/*/fallback.env',
]) {
  if (!containerRuntimeVerifier.includes(invariant)) {
    failures.push(
      `verify-container-runtime.sh: missing host isolation invariant ${invariant}`,
    );
  }
}

const runtimeImageVerifier = readFileSync(
  "runner/deploy/verify-runtime-images.sh",
  "utf8",
);
for (const invariant of [
  "zenguy-runner@sha256:[0-9a-f]{64}",
  "zenguy-egress-proxy@sha256:[0-9a-f]{64}",
  '"$cosign_bin" verify',
  "--certificate-identity",
  "ZENGUY_RUNNER_RELEASE_TAG",
  "ZENGUY_RUNNER_RELEASE_SHA",
  "refs/tags/$release_tag",
  '--certificate-github-workflow-sha "$release_sha"',
  "--certificate-github-workflow-repository maguayo/zenguy",
  "require_trusted_directory /usr",
  'version_at_least "$cosign_version" "3.0.6"',
  "GHSA-whqx-f9j3-ch6m",
  "GHSA-w6c6-c85g-mmv6",
]) {
  if (!runtimeImageVerifier.includes(invariant)) {
    failures.push(`verify-runtime-images.sh: missing signature invariant ${invariant}`);
  }
}

const squidConfig = readFileSync("runner/deploy/squid.conf", "utf8");
if (!squidConfig.includes("reply_body_max_size 32 MB all")) {
  failures.push("runner/deploy/squid.conf: plaintext response bodies must be capped");
}
if (!/^access_log\s+none\s*$/mu.test(squidConfig)) {
  failures.push(
    "runner/deploy/squid.conf: untrusted request URLs must not be persisted",
  );
}
for (const invariant of [
  "include /etc/squid/host-egress-deny.conf",
  "http_access deny forbidden_host",
  "acl forbidden_v6 dst fec0::/10",
  "acl forbidden_v6 dst 2001::/23",
  "acl forbidden_v4 dst 100.64.0.0/10",
  "acl forbidden_v4 dst 169.254.0.0/16",
]) {
  if (!squidConfig.includes(invariant)) {
    failures.push(`runner/deploy/squid.conf: missing special-address denial ${invariant}`);
  }
}

for (const path of [
  "README.md",
  "apps/api/README.md",
  "runner/browser_worker.py",
  "runner/README.md",
  "BIONIC.md",
  "BACKUP_RUNNER.md",
]) {
  const content = readFileSync(path, "utf8");
  if (
    /wrangler\s+(?:auth\s+(?:create|activate|token)|login)|--profile(?:\s|=)|zenguy-personal/u.test(
      content,
    )
  ) {
    failures.push(
      `${path}: active operational code and runbooks must never use a persistent personal Wrangler OAuth session`,
    );
  }
}
const browserWorker = readFileSync("runner/browser_worker.py", "utf8");
const runnerReadme = readFileSync("runner/README.md", "utf8");
for (const [path, content] of [
  ["runner/browser_worker.py", browserWorker],
  ["runner/README.md", runnerReadme],
]) {
  if (content.includes("allow-unsafe-host-runner")) {
    failures.push(`${path}: direct host runner override flags are forbidden`);
  }
}
for (const invariant of [
  "SENSITIVE_RUNNER_ENVIRONMENT",
  '"CF_ACCESS_CLIENT_SECRET"',
  '"CLOUDFLARE_QUEUES_TOKEN"',
  '"OPENAI_API_KEY"',
  '"ZENGUY_RUNNER_TOKEN"',
  "scrub_sensitive_runner_environment()",
  "resolve_runner_environment(staging)",
  'chromium_sandbox=True',
  'REQUIRED_CHROMIUM_SWITCH = "--site-per-process"',
  'REQUIRED_PROXY_BYPASS = "<-loopback>"',
  "assert_isolated_fallback_runtime(recycle_after_attempt)",
  "not resolved.is_global",
  'getattr(resolved, "is_site_local", False)',
  'event.get("dataLength")',
  "MAX_BROWSER_RESPONSE_BYTES",
  "MAX_BROWSER_ATTEMPT_TRANSFER_BYTES",
  'BROWSER_USE_WRAPPED_ACTIONS = {"click", "input", "select_dropdown"}',
  '"send_keys"',
  "actions.pop(action_name, None)",
  "policy.assert_interaction(current_url, \"Input\")",
  "policy.assert_interaction(current_url, \"Dropdown selection\")",
  "button/submit activation requires per-run",
  "mutating HTTP requests require per-run human",
  'snapshot.get("writableDomains", [])',
  "irreversible_scopes_from_snapshot",
  "authorize_dom_click",
  "/actions/authorize",
  '"origin": self._origin(parsed)',
]) {
  if (!browserWorker.includes(invariant)) {
    failures.push(`runner/browser_worker.py: missing child-environment isolation ${invariant}`);
  }
}
if (/HIGH_RISK_CLICK|allow_reversible_writes:\s*bool/u.test(browserWorker)) {
  failures.push(
    "runner/browser_worker.py: DOM text and a global boolean must not grant browser mutation capabilities",
  );
}
const browserWriteScopeMigration = readFileSync(
  "apps/api/migrations/0044_browser_test_exact_write_scope.sql",
  "utf8",
);
for (const invariant of [
  "ADD COLUMN writable_domains_json",
  "UPDATE browser_tests SET allow_reversible_writes = 0",
]) {
  if (!browserWriteScopeMigration.includes(invariant)) {
    failures.push(
      `0044_browser_test_exact_write_scope.sql: missing fail-closed invariant ${invariant}`,
    );
  }
}
const browserIrreversibleMigration = readFileSync(
  "apps/api/migrations/0045_browser_test_irreversible_action_authorization.sql",
  "utf8",
);
for (const invariant of [
  "test_data_attested",
  "irreversible_action_scopes_json",
  "action_authorizations_json",
]) {
  if (!browserIrreversibleMigration.includes(invariant)) {
    failures.push(
      `0045_browser_test_irreversible_action_authorization.sql: missing fail-closed invariant ${invariant}`,
    );
  }
}
for (const invariant of [
  "canonical HTTPS origin",
  "Scheduled runs never receive irreversible authority",
  "malformed, duplicated, reordered, or inflated ledger fails",
  "A human must confirm those scopes",
]) {
  if (!runnerReadme.includes(invariant)) {
    failures.push(`runner/README.md: missing SEC-37 functional gap ${invariant}`);
  }
}
const runnerEntrypoint = browserWorker.slice(
  browserWorker.indexOf("async def async_main("),
  browserWorker.indexOf("\ndef main() -> int:"),
);
if (
  !/if fallback:[\s\S]+worker = FallbackWorker\([\s\S]+else:\s+raise ConfigError\(\s+"Direct host execution is disabled for every remote environment\. "/u.test(
    runnerEntrypoint,
  ) ||
  runnerEntrypoint.includes("RunnerConfig.for_primary") ||
  runnerEntrypoint.includes("worker = Worker(")
) {
  failures.push(
    "runner/browser_worker.py: non-fallback CLI execution must fail closed with the direct-host-disabled ConfigError",
  );
}
if (
  !/if fallback:\s+assert_isolated_fallback_runtime\(recycle_after_attempt\)/u.test(
    runnerEntrypoint,
  )
) {
  failures.push(
    "runner/browser_worker.py: fallback jobs must prove isolated per-attempt execution before loading credentials",
  );
}
for (const invariant of [
  "Direct host execution is disabled",
  "for both staging and production; there is intentionally no override flag",
  "no staging or production job may execute directly on a host",
]) {
  if (!runnerReadme.includes(invariant)) {
    failures.push(`runner/README.md: missing direct-host isolation invariant ${invariant}`);
  }
}

const runnerImageWorkflow = readFileSync(
  ".github/workflows/runner-images.yml",
  "utf8",
);
const buildxInstaller = readFileSync(
  "scripts/security/install-buildx.sh",
  "utf8",
);
const trivyInstaller = readFileSync(
  "scripts/security/install-trivy.sh",
  "utf8",
);
for (const invariant of [
  "BUILDX_VERSION=v0.36.1",
  "BUILDX_SHA256=48af8a397ebd60178778bf63611dbcebe5f5e7a9be90eb9147b24b9587455778",
  'BUILDX_URL="https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-amd64"',
  "--proto '=https'",
  "--proto-redir '=https'",
  'actual_sha=$(/usr/bin/sha256sum "$download_path")',
  'installed_sha=$(/usr/bin/sha256sum "${plugin_directory}/docker-buildx")',
  '/usr/bin/docker buildx version | /usr/bin/grep -F "${BUILDX_VERSION}"',
]) {
  if (!buildxInstaller.includes(invariant)) {
    failures.push(`install-buildx.sh: missing pinned installer invariant ${invariant}`);
  }
}
for (const invariant of [
  "TRIVY_VERSION=0.73.0",
  'TRIVY_ARCHIVE="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"',
  "TRIVY_SHA256=2edd39da482bb4e9831962487b68f68e3928ec3137794757f54d00383d79547b",
  'TRIVY_URL="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${TRIVY_ARCHIVE}"',
  "--proto '=https'",
  "--proto-redir '=https'",
  'actual_sha=$(/usr/bin/sha256sum "$archive_path")',
  'archive_binary_sha=$(/usr/bin/tar --extract --gzip --to-stdout --file "$archive_path" trivy | /usr/bin/sha256sum)',
  'installed_binary_sha=$(/usr/bin/sha256sum "${install_directory}/trivy")',
  '"${install_directory}/trivy" --version | /usr/bin/grep -F "Version: ${TRIVY_VERSION}"',
]) {
  if (!trivyInstaller.includes(invariant)) {
    failures.push(`install-trivy.sh: missing pinned installer invariant ${invariant}`);
  }
}
for (const invariant of [
  'tags:\n      - "runner-v*"',
  "push: true",
  "provenance: mode=max",
  "sbom: true",
  "--severity HIGH,CRITICAL",
  "--exit-code 1",
  "cosign sign --yes",
  "cosign verify",
  "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
  '--certificate-github-workflow-sha "$GITHUB_SHA"',
  'release_sha=%s',
  "steps.release-build.outputs.digest",
  "needs: runner-tests",
  "fetch-depth: 0",
  "git merge-base --is-ancestor \"$GITHUB_SHA\" refs/remotes/origin/main",
  "git rev-parse refs/remotes/origin/main",
  "Verify release commit after Environment approval",
  "Verify release commit immediately before signing",
  "docker compose --file runner/deploy/compose.yml config --quiet",
  "--verify-locked-runtime",
  "--only-binary=:all: --require-hashes",
  "--verify-browser-sandbox",
  "BUILDX_DEFAULT_POLICY: \"1\"",
  "sh scripts/security/install-buildx.sh",
  "sh scripts/security/install-trivy.sh",
  "--driver-opt image=moby/buildkit:v0.32.2@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8",
  "environment: runner-release",
]) {
  if (!runnerImageWorkflow.includes(invariant)) {
    failures.push(`runner-images.yml: missing supply-chain invariant ${invariant}`);
  }
}
const validationImageJob = runnerImageWorkflow.slice(
  runnerImageWorkflow.indexOf("  validation-images:"),
  runnerImageWorkflow.indexOf("  release-images:"),
);
const releaseImageJob = runnerImageWorkflow.slice(
  runnerImageWorkflow.indexOf("  release-images:"),
);
const exactRunnerReleaseCondition =
  "if: ${{ github.event_name == 'push' && github.repository == 'maguayo/zenguy' && startsWith(github.ref, 'refs/tags/runner-v') }}";
if (
  !releaseImageJob.includes(exactRunnerReleaseCondition) ||
  (runnerImageWorkflow.match(/^\s+packages:\s*write\s*$/gmu) ?? []).length !== 1 ||
  (runnerImageWorkflow.match(/^\s+id-token:\s*write\s*$/gmu) ?? []).length !== 1 ||
  !releaseImageJob.includes("packages: write") ||
  !releaseImageJob.includes("id-token: write")
) {
  failures.push(
    "runner-images.yml: registry and OIDC writes must exist only under the exact tag-push release condition",
  );
}
const requiredImageSmokeInvariants = [
  "--network none",
  "--user 10001:10001",
  "--read-only",
  "--cap-drop ALL",
  "--security-opt no-new-privileges:true",
  "--security-opt seccomp=runner/deploy/seccomp/chromium-moby-v0.2.1.json",
  "--verify-browser-sandbox",
];
if (
  (runnerImageWorkflow.match(/BUILDX_DEFAULT_POLICY: "1"/gu) ?? []).length !== 2 ||
  (runnerImageWorkflow.match(/run: sh scripts\/security\/install-buildx\.sh/gu) ?? [])
    .length !== 2 ||
  (runnerImageWorkflow.match(/run: sh scripts\/security\/install-trivy\.sh/gu) ?? [])
    .length !== 2 ||
  (runnerImageWorkflow.match(/\$RUNNER_TEMP\/zenguy-tools\/trivy/gu) ?? [])
    .length !== 2 ||
  (runnerImageWorkflow.match(/docker buildx create/gu) ?? []).length !== 2 ||
  (runnerImageWorkflow.match(/moby\/buildkit:v0\.32\.2@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8/gu) ?? []).length !== 2 ||
  runnerImageWorkflow.includes("aquasecurity/trivy-action") ||
  runnerImageWorkflow.includes("docker/setup-buildx-action") ||
  runnerImageWorkflow.includes("allow-insecure-entitlement") ||
  runnerImageWorkflow.includes("security.insecure") ||
  runnerImageWorkflow.includes("network.host")
) {
  failures.push(
    "runner-images.yml: validation and release must use hash-pinned Buildx and an authenticated builder without insecure entitlements",
  );
}
for (const [jobName, job] of [
  ["validation", validationImageJob],
  ["release", releaseImageJob],
]) {
  for (const invariant of requiredImageSmokeInvariants) {
    if (!job.includes(invariant)) {
      failures.push(
        `runner-images.yml: ${jobName} image job is missing sandbox smoke invariant ${invariant}`,
      );
    }
  }
}
if (
  !validationImageJob.includes("github.event_name == 'pull_request'") ||
  !validationImageJob.includes("github.event_name == 'workflow_dispatch'") ||
  validationImageJob.includes("packages: write") ||
  validationImageJob.includes("id-token: write") ||
  validationImageJob.includes("push: true")
) {
  failures.push(
    "runner-images.yml: validation job must stay read-only and non-publishing",
  );
}
const releaseScan = releaseImageJob.indexOf("- name: Scan published digest");
const releaseSmoke = releaseImageJob.indexOf(
  "- name: Launch published Chromium in the exact runner sandbox",
);
const releasePostApprovalFence = releaseImageJob.indexOf(
  "- name: Verify release commit after Environment approval",
);
const releaseBuild = releaseImageJob.indexOf(
  "- name: Build and publish immutable release image once",
);
const releasePreSignatureFence = releaseImageJob.indexOf(
  "- name: Verify release commit immediately before signing",
);
const releaseSignature = releaseImageJob.indexOf(
  "- name: Sign and verify the published digest",
);
if (
  releasePostApprovalFence === -1 ||
  releaseBuild <= releasePostApprovalFence ||
  releaseScan === -1 ||
  releaseSmoke <= releaseScan ||
  releasePreSignatureFence <= releaseSmoke ||
  releaseSignature <= releasePreSignatureFence ||
  (releaseImageJob.match(/git\/ref\/heads\/main/gu) ?? []).length !== 2 ||
  (releaseImageJob.match(/test "\$GITHUB_SHA" = "\$current_sha"/gu) ?? [])
    .length !== 2
) {
  failures.push(
    "runner-images.yml: the protected release must re-fence main around build, scan and sandbox smoke before signing",
  );
}
for (const invariant of [
  "github.event_name == 'push'",
  "github.repository == 'maguayo/zenguy'",
  "startsWith(github.ref, 'refs/tags/runner-v')",
  "packages: write",
  "id-token: write",
  "environment: runner-release",
]) {
  if (!releaseImageJob.includes(invariant)) {
    failures.push(`runner-images.yml: release job missing protected invariant ${invariant}`);
  }
}
for (const line of runnerImageWorkflow.split(/\r?\n/u)) {
  const match = line.match(/^\s*-?\s*uses:\s+([^\s]+)$/u);
  if (match !== null && !/@[0-9a-f]{40}$/u.test(match[1])) {
    failures.push(`runner-images.yml: action must be pinned by commit (${match[1]})`);
  }
}

const frontendHeaders = readFileSync("apps/frontend/public/_headers", "utf8");
const paddleScriptUrl = "https://cdn.paddle.com/paddle/v2/paddle.js";
if (!frontendHeaders.includes(`script-src 'self' ${paddleScriptUrl};`)) {
  failures.push("apps/frontend/public/_headers: Paddle script-src must allow only its exact SDK path");
}
if (frontendHeaders.includes("script-src 'self' https://cdn.paddle.com;")) {
  failures.push("apps/frontend/public/_headers: Paddle's whole CDN origin must not be script-trusted");
}

const exceptions = JSON.parse(readFileSync("security/audit-exceptions.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);
const securityWorkflow = readFileSync(".github/workflows/security.yml", "utf8");
if (!securityWorkflow.includes("node --test apps/api/scripts/local-secrets.test.mjs")) {
  failures.push("security.yml: memory-only Keychain transport tests must run in CI");
}
if (
  !securityWorkflow.includes(
    "node --test scripts/security/audit-cloudflare-edge.test.mjs apps/api/scripts/verify-remote-secrets.test.mjs apps/admin/scripts/verify-remote-secrets.test.mjs",
  )
) {
  failures.push("security.yml: read-only remote-control guard tests must run in CI");
}
const edgeAuditJobStart = securityWorkflow.indexOf("  cloudflare-edge-audit:");
const clientSecurityJobStart = securityWorkflow.indexOf(
  "  client-and-supply-chain:",
);
const edgeAuditJob = securityWorkflow.slice(
  edgeAuditJobStart,
  clientSecurityJobStart,
);
for (const invariant of [
  "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  "github.ref == 'refs/heads/main'",
  "environment:\n      name: security-audit",
  "permissions:\n      contents: read",
  "secrets.CLOUDFLARE_SECURITY_AUDIT_TOKEN",
  "vars.CLOUDFLARE_ACCOUNT_ID",
  "vars.CLOUDFLARE_ZONE_ID",
  "run: node scripts/security/audit-cloudflare-edge.mjs",
]) {
  if (
    edgeAuditJobStart === -1 ||
    clientSecurityJobStart <= edgeAuditJobStart ||
    !edgeAuditJob.includes(invariant)
  ) {
    failures.push(`security.yml: isolated scheduled edge audit is missing ${invariant}`);
  }
}
if (
  (securityWorkflow.match(/secrets\.CLOUDFLARE_SECURITY_AUDIT_TOKEN/gu) ?? [])
    .length !== 1 ||
  edgeAuditJob.includes("secrets.CLOUDFLARE_API_TOKEN")
) {
  failures.push(
    "security.yml: live edge audit must receive only its dedicated Environment secret",
  );
}
const rootManifest = JSON.parse(readFileSync("package.json", "utf8"));
if (
  rootManifest.scripts?.["security:audit:cloudflare"] !==
  "node scripts/security/audit-cloudflare-edge.mjs"
) {
  failures.push("package.json: Cloudflare edge audit must use the reviewed read-only script");
}
const cloudflareEdgePolicy = JSON.parse(
  readFileSync("security/cloudflare-edge-policy.json", "utf8"),
);
const { allowedSkipRuleIds: configuredSkipRuleIds, ...cloudflarePolicyContract } =
  cloudflareEdgePolicy;
if (
  !Array.isArray(configuredSkipRuleIds) ||
  JSON.stringify(cloudflarePolicyContract) !==
    JSON.stringify({
      policyVersion: 3,
      zoneName: "zenguy.com",
      maximumAccountIpAllowRules: 0,
      maximumZoneIpAllowRules: 0,
      requiredCustomRule: {
        phase: "http_request_firewall_custom",
        ref: "zenguy_block_sensitive_file_probes_v2",
        description: "Block sensitive probes and truncated API headers (v2)",
        action: "block",
        expression:
          '(http.request.uri.path eq "/.env") or (http.request.uri.path eq "/.git/config") or (starts_with(http.request.uri.path, "/api/") and http.request.headers.truncated)',
      },
      requiredManagedRule: {
        phase: "http_request_firewall_managed",
        action: "execute",
        expression: "true",
        allowedTargetRulesets: [
          { name: "Cloudflare Free Managed Ruleset" },
          {
            name: "Cloudflare Managed Ruleset",
            id: "efb7b8c949ac4650a09736fc376e9aee",
          },
        ],
      },
      requiredRateLimitRules: [
        {
          phase: "http_ratelimit",
          ref: "zenguy_auth_abuse_rate_limit_v1",
          description:
            "Managed challenge for abusive authentication traffic (v1)",
          action: "managed_challenge",
          expression:
            '(http.request.uri.path eq "/api/auth/register") or (http.request.uri.path eq "/api/auth/login") or (http.request.uri.path eq "/api/auth/resend-verification") or (http.request.uri.path eq "/api/auth/forgot-password") or (http.request.uri.path eq "/api/auth/reset-password")',
          ratelimit: {
            characteristics: ["cf.colo.id", "ip.src"],
            period: 10,
            requests_per_period: 10,
            mitigation_timeout: 0,
          },
        },
        {
          phase: "http_ratelimit",
          ref: "zenguy_resource_exhaustion_rate_limit_v1",
          description:
            "Block abusive runner, webhook and expensive workspace traffic (v1)",
          action: "block",
          expression:
            '(http.request.uri.path eq "/api/webhooks/paddle") or starts_with(http.request.uri.path, "/api/runner/") or (starts_with(http.request.uri.path, "/api/workspaces/") and ((http.request.uri.path contains "/browser-tests/") or (http.request.uri.path contains "/runs") or (http.request.uri.path contains "/channels")))',
          ratelimit: {
            characteristics: ["cf.colo.id", "ip.src"],
            period: 10,
            requests_per_period: 120,
            mitigation_timeout: 60,
          },
        },
      ],
    })
) {
  failures.push(
    "security/cloudflare-edge-policy.json: exact versioned custom/rate rules and real managed targets are required",
  );
}
const cloudflareEdgeAudit = readFileSync(
  "scripts/security/audit-cloudflare-edge.mjs",
  "utf8",
);
for (const invariant of [
  'const API_BASE = "https://api.cloudflare.com/client/v4"',
  'method: "GET"',
  'redirect: "error"',
  'mode: "whitelist"',
  '"http_request_firewall_custom"',
  '"http_request_firewall_managed"',
  '"http_ratelimit"',
  'target.kind !== "managed"',
  "isDeepStrictEqual(rule.ratelimit, expected.ratelimit)",
  "CLOUDFLARE_SECURITY_AUDIT_TOKEN",
]) {
  if (!cloudflareEdgeAudit.includes(invariant)) {
    failures.push(`audit-cloudflare-edge.mjs: missing read-only invariant ${invariant}`);
  }
}
if (/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/u.test(cloudflareEdgeAudit)) {
  failures.push("audit-cloudflare-edge.mjs: mutating Cloudflare HTTP methods are forbidden");
}
const workspaceConfigs = ["pnpm-workspace.yaml", "apps/app/pnpm-workspace.yaml"];
for (const path of workspaceConfigs) {
  if (/ignoreGhsas/u.test(readFileSync(path, "utf8"))) {
    failures.push(`${path}: audit advisories must not be hidden in global pnpm config`);
  }
}

const documentedAuditExceptions = new Set();
for (const exception of exceptions) {
  if (
    typeof exception.id !== "string" ||
    typeof exception.expires !== "string" ||
    typeof exception.package !== "string" ||
    typeof exception.patch !== "string" ||
    typeof exception.reason !== "string" ||
    typeof exception.version !== "string" ||
    ![".", "apps/app"].includes(exception.workspace)
  ) {
    failures.push("security/audit-exceptions.json: malformed exception");
  } else if (exception.expires < today) {
    failures.push(`${exception.id}: audit exception expired on ${exception.expires}`);
  } else {
    const key = `${exception.workspace}:${exception.id}`;
    if (documentedAuditExceptions.has(key)) {
      failures.push(`${key}: duplicate audit exception`);
      continue;
    }
    documentedAuditExceptions.add(key);

    if (!existsSync(exception.patch)) {
      failures.push(`${exception.id}: local mitigation patch is missing (${exception.patch})`);
      continue;
    }
    const configPath = `${exception.workspace === "." ? "" : `${exception.workspace}/`}pnpm-workspace.yaml`;
    const lockPath = `${exception.workspace === "." ? "" : `${exception.workspace}/`}pnpm-lock.yaml`;
    const configuredPatch = `${exception.package}@${exception.version}: ${relative(exception.workspace, exception.patch)}`;
    if (!readFileSync(configPath, "utf8").includes(configuredPatch)) {
      failures.push(`${exception.id}: ${configPath} does not configure ${exception.patch}`);
    }
    const lock = readFileSync(lockPath, "utf8");
    if (!lock.includes(`${exception.package}@${exception.version}:`) || !lock.includes("patch_hash=")) {
      failures.push(`${exception.id}: ${lockPath} does not seal the patched dependency`);
    }
    if (!securityWorkflow.includes(`--ignore ${exception.id}`)) {
      failures.push(`${exception.id}: CI audit exception is not explicit in security.yml`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`security check failed: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Repository credential, permission and exception guards passed.");
}
