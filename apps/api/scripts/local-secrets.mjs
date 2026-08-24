import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KEYCHAIN_SERVICE = "com.zenguy.api.local-development.v1";

export const DEVELOPMENT_SECRET_NAMES = Object.freeze([
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_ID",
  "ENCRYPTION_PREVIOUS_KEYS",
  "ARTIFACT_URL_SECRET",
  "RUNNER_API_TOKEN",
  "RUNNER_FALLBACK_API_TOKEN",
  "RUNNER_CAPABILITY_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_SMS",
  "TWILIO_FROM_WHATSAPP",
  "TWILIO_FROM_CALL",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "PADDLE_OVERAGE_PRICE_ID",
  "PADDLE_ALERT_CREDIT_PRODUCT_ID",
  "PADDLE_ALERT_CREDIT_PRICE_ID",
  "EXPO_PUSH_ACCESS_TOKEN",
]);

export const REQUIRED_DEVELOPMENT_SECRET_NAMES = Object.freeze([
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_ID",
  "ARTIFACT_URL_SECRET",
  "RUNNER_API_TOKEN",
  "RUNNER_FALLBACK_API_TOKEN",
  "RUNNER_CAPABILITY_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_SMS",
  "TWILIO_FROM_CALL",
]);

const OPTIONAL_DEVELOPMENT_SECRET_NAMES = DEVELOPMENT_SECRET_NAMES.filter(
  (name) => !REQUIRED_DEVELOPMENT_SECRET_NAMES.includes(name),
);
const SEED_SECRET_NAMES = Object.freeze([
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_ID",
]);
const PADDLE_REQUIRED_NAMES = Object.freeze([
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "PADDLE_OVERAGE_PRICE_ID",
]);
const INDEPENDENT_SECRET_NAMES = Object.freeze([
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "ARTIFACT_URL_SECRET",
  "RUNNER_API_TOKEN",
  "RUNNER_FALLBACK_API_TOKEN",
  "RUNNER_CAPABILITY_SECRET",
]);
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SECURITY_BINARY = "/usr/bin/security";
const MKFIFO_BINARY = "/usr/bin/mkfifo";
const API_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_DIRECTORY = resolve(API_DIRECTORY, "../..");
export const LOCAL_SENSITIVE_FILES = Object.freeze([
  ["apps/api/.dev.vars", resolve(API_DIRECTORY, ".dev.vars")],
  ["apps/api/.ci.staging.vars", resolve(API_DIRECTORY, ".ci.staging.vars")],
  [
    "apps/frontend/.env.local",
    resolve(REPOSITORY_DIRECTORY, "apps/frontend/.env.local"),
  ],
  ["apps/app/.env.local", resolve(REPOSITORY_DIRECTORY, "apps/app/.env.local")],
  [
    "apps/app/credentials/updates-private-key.pem",
    resolve(REPOSITORY_DIRECTORY, "apps/app/credentials/updates-private-key.pem"),
  ],
  [
    "runner/.browser_worker.local.json",
    resolve(REPOSITORY_DIRECTORY, "runner/.browser_worker.local.json"),
  ],
  ["TWILIO_TOKENS.md", resolve(REPOSITORY_DIRECTORY, "TWILIO_TOKENS.md")],
]);
const WRANGLER_ENTRYPOINT = resolve(
  API_DIRECTORY,
  "node_modules/wrangler/bin/wrangler.js",
);
const FIFO_WRITER = resolve(
  API_DIRECTORY,
  "scripts/local-secret-fifo-writer.mjs",
);
const MAX_KEYCHAIN_VALUE_BYTES = 32 * 1024;
const MAX_SERIALIZED_SECRET_BYTES = 512 * 1024;
const SAFE_CHILD_ENVIRONMENT_NAMES = Object.freeze([
  "CI",
  "COLORTERM",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NO_COLOR",
  "TERM",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
]);

export function buildSafeChildEnvironment(source = process.env) {
  // A caller-controlled CLOUDFLARE_INCLUDE_PROCESS_ENV would turn every shell
  // variable into a Worker binding. Start from an allowlist instead of trying
  // to enumerate every credential-shaped environment variable to remove.
  const environment = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  for (const name of SAFE_CHILD_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (typeof value === "string") environment[name] = value;
  }
  return environment;
}

function assertSupportedPlatform(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error(
      "The local API secret loader requires macOS Keychain; do not fall back to a plaintext .dev.vars file",
    );
  }
}

function assertTrustedSystemBinary(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0) {
    throw new Error(`${path} is not a trusted system executable`);
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(`${path} must not be group/world writable`);
  }
}

function assertTrustedSecurityBinary() {
  assertTrustedSystemBinary(SECURITY_BINARY);
}

/**
 * Verifies only filesystem metadata. This deliberately never opens a local
 * credential file, so an audit cannot copy its values into the Node process.
 */
export function assertPrivateLocalSecretFile(
  label,
  path,
  statFile = lstatSync,
  currentUid = typeof process.getuid === "function" ? process.getuid() : null,
) {
  let stat;
  try {
    stat = statFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, never a symlink`);
  }
  if (currentUid !== null && stat.uid !== currentUid) {
    throw new Error(`${label} must be owned by the current user`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must use mode 0600`);
  }
  return true;
}

export function auditLocalSensitiveFiles(
  entries = LOCAL_SENSITIVE_FILES,
  statFile = lstatSync,
  currentUid = typeof process.getuid === "function" ? process.getuid() : null,
) {
  const present = [];
  for (const [label, path] of entries) {
    if (assertPrivateLocalSecretFile(label, path, statFile, currentUid)) {
      present.push(label);
    }
  }
  return present;
}

export function createPrivateSecretFifo(spawnMkfifo = spawnSync) {
  assertTrustedSystemBinary(MKFIFO_BINARY);
  const directory = mkdtempSync(join(tmpdir(), "zenguy-api-secrets-"));
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (directoryStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" &&
      directoryStat.uid !== process.getuid())
  ) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("The local secret transport directory is not private");
  }
  const path = join(directory, "bindings.env");
  const result = spawnMkfifo(MKFIFO_BINARY, ["-m", "600", path], {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Could not create the local secret transport FIFO");
  }
  const fifoStat = lstatSync(path);
  if (
    !fifoStat.isFIFO() ||
    fifoStat.isSymbolicLink() ||
    (fifoStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && fifoStat.uid !== process.getuid())
  ) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("The local secret transport is not a private FIFO");
  }
  return {
    directory,
    path,
    directoryDevice: directoryStat.dev,
    directoryInode: directoryStat.ino,
  };
}

function removePrivateSecretFifo(transport) {
  try {
    const stat = lstatSync(transport.directory);
    if (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.dev === transport.directoryDevice &&
      stat.ino === transport.directoryInode
    ) {
      rmSync(transport.directory, { recursive: true, force: true });
    }
  } catch {
    // It may already be gone after an interrupted development process.
  }
}

function assertAllowedName(name) {
  if (!DEVELOPMENT_SECRET_NAMES.includes(name)) {
    throw new Error(`Unsupported local secret name: ${name}`);
  }
}

function keychainLookupArguments(name, includeValue) {
  return [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    name,
    ...(includeValue ? ["-w"] : []),
  ];
}

export function keychainItemExists(name, spawnSecurity = spawnSync) {
  assertAllowedName(name);
  const result = spawnSecurity(
    SECURITY_BINARY,
    keychainLookupArguments(name, false),
    { stdio: "ignore" },
  );
  return result.status === 0;
}

export function readKeychainItem(name, spawnSecurity = spawnSync) {
  assertAllowedName(name);
  const result = spawnSecurity(
    SECURITY_BINARY,
    keychainLookupArguments(name, true),
    {
      encoding: "buffer",
      maxBuffer: MAX_KEYCHAIN_VALUE_BYTES + 2,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  if (result.stdout.byteLength > MAX_KEYCHAIN_VALUE_BYTES) {
    result.stdout.fill(0);
    throw new Error(`${name} exceeds the local Keychain value limit`);
  }
  let value = result.stdout.toString("utf8");
  result.stdout.fill(0);
  if (value.endsWith("\r\n")) value = value.slice(0, -2);
  else if (value.endsWith("\n")) value = value.slice(0, -1);
  if (value === "") throw new Error(`${name} is empty in Keychain`);
  return value;
}

function decodeCanonicalEncryptionKey(value, name) {
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/u.test(value)) {
    throw new Error(`${name} must be canonical base64 for exactly 32 bytes`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new Error(`${name} must be canonical base64 for exactly 32 bytes`);
  }
  decoded.fill(0);
}

function validatePreviousEncryptionKeys(value, currentKeyId) {
  if (value === undefined) return;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS must be a JSON object");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS must be a JSON object");
  }
  const entries = Object.entries(parsed);
  if (entries.length > 8) {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS supports at most 8 entries");
  }
  for (const [id, key] of entries) {
    if (!KEY_ID_PATTERN.test(id) || typeof key !== "string") {
      throw new Error("ENCRYPTION_PREVIOUS_KEYS contains an invalid entry");
    }
    if (id === currentKeyId) {
      throw new Error("ENCRYPTION_PREVIOUS_KEYS must not repeat ENCRYPTION_KEY_ID");
    }
    decodeCanonicalEncryptionKey(key, `Previous encryption key ${id}`);
  }
}

export function validateSecretSet(values, target = "dev") {
  const required = target === "seed"
    ? SEED_SECRET_NAMES
    : REQUIRED_DEVELOPMENT_SECRET_NAMES;
  const missing = required.filter((name) => {
    const value = values.get(name);
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Missing required Keychain items: ${missing.join(", ")}`);
  }

  for (const [name, value] of values) {
    assertAllowedName(name);
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} must be a non-empty string`);
    }
    if (Buffer.byteLength(value, "utf8") > MAX_KEYCHAIN_VALUE_BYTES) {
      throw new Error(`${name} exceeds the local Keychain value limit`);
    }
    if (value.includes("\0")) {
      throw new Error(`${name} must not contain a NUL byte`);
    }
    if (value.includes("\r") || value.includes("\n")) {
      throw new Error(`${name} must not contain a line break`);
    }
    if (value.startsWith("replace-with-")) {
      throw new Error(`${name} must not use a public placeholder`);
    }
  }

  const encryptionKey = values.get("ENCRYPTION_KEY");
  const encryptionKeyId = values.get("ENCRYPTION_KEY_ID");
  if (encryptionKey !== undefined) {
    decodeCanonicalEncryptionKey(encryptionKey, "ENCRYPTION_KEY");
  }
  if (encryptionKeyId !== undefined && !KEY_ID_PATTERN.test(encryptionKeyId)) {
    throw new Error("ENCRYPTION_KEY_ID is invalid");
  }
  validatePreviousEncryptionKeys(
    values.get("ENCRYPTION_PREVIOUS_KEYS"),
    encryptionKeyId,
  );

  if (target === "dev") {
    for (const name of [
      "JWT_SECRET",
      "ARTIFACT_URL_SECRET",
      "RUNNER_API_TOKEN",
      "RUNNER_FALLBACK_API_TOKEN",
      "RUNNER_CAPABILITY_SECRET",
    ]) {
      if ((values.get(name)?.length ?? 0) < 32) {
        throw new Error(`${name} must contain at least 32 characters`);
      }
    }
    const seen = new Map();
    for (const name of INDEPENDENT_SECRET_NAMES) {
      const value = values.get(name);
      if (value === undefined) continue;
      const prior = seen.get(value);
      if (prior !== undefined) {
        throw new Error(`${name} must be independent from ${prior}`);
      }
      seen.set(value, name);
    }

    const configuredPaddleNames = PADDLE_REQUIRED_NAMES.filter((name) =>
      values.has(name)
    );
    if (
      configuredPaddleNames.length > 0 &&
      configuredPaddleNames.length !== PADDLE_REQUIRED_NAMES.length
    ) {
      const absent = PADDLE_REQUIRED_NAMES.filter((name) => !values.has(name));
      throw new Error(`Incomplete Paddle Keychain group; missing: ${absent.join(", ")}`);
    }
    const alertProduct = values.has("PADDLE_ALERT_CREDIT_PRODUCT_ID");
    const alertPrice = values.has("PADDLE_ALERT_CREDIT_PRICE_ID");
    if (alertProduct !== alertPrice) {
      throw new Error(
        "PADDLE_ALERT_CREDIT_PRODUCT_ID and PADDLE_ALERT_CREDIT_PRICE_ID must be configured together",
      );
    }
  }
}

function quoteDotEnvValue(value, name) {
  const escaped = value.replaceAll("$", "\\$");
  if (!escaped.includes("'")) return `'${escaped}'`;
  if (!escaped.includes("`")) return `\`${escaped}\``;
  if (!escaped.includes('"') && !/\\[nr]/u.test(escaped)) {
    return `"${escaped}"`;
  }
  throw new Error(`${name} cannot be represented safely for Wrangler`);
}

export function serializeSecretEnv(values) {
  validateSecretSet(values, values.has("JWT_SECRET") ? "dev" : "seed");
  return `${[...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${quoteDotEnvValue(value, name)}`)
    .join("\n")}\n`;
}

async function collectKeychainValues(target, reader = readKeychainItem) {
  const names = target === "seed"
    ? SEED_SECRET_NAMES
    : DEVELOPMENT_SECRET_NAMES;
  const values = new Map();
  for (const name of names) {
    const value = reader(name);
    if (value !== null) values.set(name, value);
  }
  validateSecretSet(values, target);
  return values;
}

function assertSafeDevelopmentArguments(arguments_) {
  let sawPort = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    let port;
    if (argument === "--port") {
      port = arguments_[index + 1];
      index += 1;
    } else if (argument.startsWith("--port=")) {
      port = argument.slice("--port=".length);
    } else {
      throw new Error(
        "wrangler dev accepts only --port; its bind addresses, inspector, config, state, env file, tunnel, and entrypoint are fixed",
      );
    }
    if (
      sawPort ||
      typeof port !== "string" ||
      !/^[1-9][0-9]{0,4}$/u.test(port) ||
      Number(port) > 65_535
    ) {
      throw new Error("--port must be one unique TCP port from 1 through 65535");
    }
    sawPort = true;
  }
}

function assertSafeForwardedArguments(target, arguments_) {
  if (target === "dev") {
    assertSafeDevelopmentArguments(arguments_);
    return;
  }
  for (const argument of arguments_) {
    if (
      argument === "--env-file" ||
      argument.startsWith("--env-file=") ||
      argument === "--config" ||
      argument.startsWith("--config=") ||
      argument === "-c" ||
      argument.startsWith("-c=") ||
      (/^-c[^-]/u.test(argument) && argument.length > 2) ||
      argument === "--cwd" ||
      argument.startsWith("--cwd=")
    ) {
      throw new Error(
        "The config, working directory, and env file are controlled by the Keychain loader",
      );
    }
    if (
      target === "seed" &&
      (argument === "--vars-file" || argument.startsWith("--vars-file="))
    ) {
      throw new Error("--vars-file is controlled by the Keychain loader");
    }
    if (
      argument === "--remote" ||
      argument.startsWith("--remote=") ||
      argument === "--env" ||
      argument.startsWith("--env=") ||
      argument === "-e" ||
      argument.startsWith("-e=") ||
      (/^-e[^-]/u.test(argument) && argument.length > 2) ||
      argument === "--allow-remote" ||
      argument === "--confirm-staging"
    ) {
      throw new Error(
        "Remote/named-environment development is disabled: use an isolated deployment with its own Worker secrets",
      );
    }
  }
}

export function childInvocation(target, forwarded = [], secretPath) {
  assertSafeForwardedArguments(target, forwarded);
  if (target === "dev") {
    if (secretPath === undefined || !isAbsolute(secretPath)) {
      throw new Error("Development requires an absolute private FIFO path");
    }
    return {
      command: process.execPath,
      arguments: [
        WRANGLER_ENTRYPOINT,
        "dev",
        "--env-file",
        secretPath,
        "--ip",
        "127.0.0.1",
        "--inspector-ip",
        "127.0.0.1",
        ...forwarded,
      ],
    };
  }
  if (target === "seed") {
    return {
      command: process.execPath,
      arguments: [
        resolve(API_DIRECTORY, "scripts/seed.mjs"),
        "--vars-file",
        "/dev/fd/3",
        ...forwarded,
      ],
    };
  }
  throw new Error("run accepts only dev or seed");
}

async function superviseChild(child, cleanup) {
  const forwardedSignals = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => child.kill(signal);
    forwardedSignals.set(signal, handler);
    process.once(signal, handler);
  }
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error, code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      for (const [forwardedSignal, handler] of forwardedSignals) {
        process.removeListener(forwardedSignal, handler);
      }
      if (error !== null) rejectPromise(error);
      else resolvePromise(code ?? (signal === null ? 1 : 128));
    };
    child.once("error", (error) => finish(error, null, null));
    child.once("exit", (code, signal) => finish(null, code, signal));
  });
}

async function runSeedWithAnonymousDescriptor(payloadBuffer, forwarded) {
  const invocation = childInvocation("seed", forwarded);
  const child = spawn(invocation.command, invocation.arguments, {
    cwd: API_DIRECTORY,
    env: buildSafeChildEnvironment(),
    stdio: ["inherit", "inherit", "inherit", "pipe"],
  });
  const descriptor = child.stdio[3];
  descriptor.on("error", (error) => {
    if (error?.code !== "EPIPE") child.kill("SIGTERM");
  });
  descriptor.end(payloadBuffer, () => payloadBuffer.fill(0));
  return await superviseChild(child, () => payloadBuffer.fill(0));
}

async function runDevWithPrivateFifo(payloadBuffer, forwarded) {
  const transport = createPrivateSecretFifo();
  const writer = spawn(
    process.execPath,
    [FIFO_WRITER, transport.path, String(process.pid)],
    {
    cwd: API_DIRECTORY,
    env: buildSafeChildEnvironment(),
    stdio: ["ignore", "ignore", "inherit", "pipe"],
    },
  );
  const invocation = childInvocation("dev", forwarded, transport.path);
  const child = spawn(invocation.command, invocation.arguments, {
    cwd: API_DIRECTORY,
    env: buildSafeChildEnvironment(),
    stdio: "inherit",
  });
  let cleaningUp = false;
  let writerFailure = null;
  const stopForWriterFailure = (message) => {
    if (cleaningUp) return;
    writerFailure = new Error(message);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  };
  writer.once("error", () => {
    stopForWriterFailure("Could not start the private local secret transport");
  });
  writer.once("exit", (code, signal) => {
    if (!cleaningUp && child.exitCode === null && child.signalCode === null) {
      stopForWriterFailure(
        `The private local secret transport stopped unexpectedly (${code ?? signal ?? "unknown"})`,
      );
    }
  });
  writer.stdio[3].on("error", (error) => {
    if (error?.code !== "ECONNRESET" || error?.syscall !== "read") {
      writer.kill("SIGKILL");
    }
  });
  writer.stdio[3].end(payloadBuffer, () => payloadBuffer.fill(0));
  const status = await superviseChild(child, () => {
    cleaningUp = true;
    payloadBuffer.fill(0);
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.kill("SIGKILL");
    }
    writer.unref();
    removePrivateSecretFifo(transport);
  });
  if (writerFailure !== null) throw writerFailure;
  return status;
}

async function runWithKeychainSecrets(target, forwarded) {
  // Reject alternate configs, env files, state roots, and remote targets before
  // reading Keychain values or creating any transport resources.
  assertSafeForwardedArguments(target, forwarded);
  const values = await collectKeychainValues(target);
  let payload = serializeSecretEnv(values);
  values.clear();
  const payloadBuffer = Buffer.from(payload, "utf8");
  payload = "";
  if (payloadBuffer.byteLength > MAX_SERIALIZED_SECRET_BYTES) {
    payloadBuffer.fill(0);
    throw new Error("The serialized local Keychain payload is too large");
  }
  return target === "dev"
    ? await runDevWithPrivateFifo(payloadBuffer, forwarded)
    : await runSeedWithAnonymousDescriptor(payloadBuffer, forwarded);
}

export function setKeychainItem(name, replace, spawnSecurity = spawnSync) {
  assertAllowedName(name);
  if (!replace && keychainItemExists(name, spawnSecurity)) {
    throw new Error(
      `${name} already exists; pass --replace only for an intentional rotation`,
    );
  }
  const arguments_ = [
    "add-generic-password",
    ...(replace ? ["-U"] : []),
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    name,
    "-l",
    `Zenguy local API — ${name}`,
    "-j",
    "Local development only; never reuse in staging or production",
    // Keep -w last: /usr/bin/security then prompts instead of receiving the
    // secret in argv, where other host processes could inspect it.
    "-w",
  ];
  const result = spawnSecurity(SECURITY_BINARY, arguments_, {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Keychain did not store ${name}`);
}

function printInventory() {
  process.stdout.write("Required for `pnpm dev`:\n");
  for (const name of REQUIRED_DEVELOPMENT_SECRET_NAMES) {
    process.stdout.write(`  ${name}\n`);
  }
  process.stdout.write("Optional (Paddle core is all-or-none):\n");
  for (const name of OPTIONAL_DEVELOPMENT_SECRET_NAMES) {
    process.stdout.write(`  ${name}\n`);
  }
}

function printStatus() {
  let requiredCount = 0;
  const optional = [];
  for (const name of DEVELOPMENT_SECRET_NAMES) {
    if (!keychainItemExists(name)) continue;
    if (REQUIRED_DEVELOPMENT_SECRET_NAMES.includes(name)) requiredCount += 1;
    else optional.push(name);
  }
  process.stdout.write(
    `Required Keychain items: ${requiredCount}/${REQUIRED_DEVELOPMENT_SECRET_NAMES.length}\n`,
  );
  process.stdout.write(
    optional.length === 0
      ? "Optional Keychain items: none\n"
      : `Optional Keychain items: ${optional.join(", ")}\n`,
  );
  process.stdout.write("No secret values were read or printed.\n");
}

function printLocalFileAudit(present) {
  process.stdout.write(
    `Sensitive local files with private metadata: ${present.length}/${LOCAL_SENSITIVE_FILES.length}.\n`,
  );
  if (present.includes("apps/api/.dev.vars")) {
    process.stdout.write(
      "Legacy apps/api/.dev.vars remains present; migrate interactively to Keychain, verify retained local data, then remove it only with explicit approval.\n",
    );
  }
  process.stdout.write("Only file type, owner and mode were inspected; no values were read.\n");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/local-secrets.mjs list",
    "  node scripts/local-secrets.mjs status",
    "  node scripts/local-secrets.mjs audit-local",
    "  node scripts/local-secrets.mjs verify [dev|seed]",
    "  node scripts/local-secrets.mjs set NAME [--replace]",
    "  node scripts/local-secrets.mjs run dev [-- WRANGLER_ARGS...]",
    "  node scripts/local-secrets.mjs run seed [-- SEED_ARGS...]",
  ].join("\n");
}

function withoutSeparator(arguments_) {
  return arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
}

export async function main(argv = process.argv.slice(2)) {
  assertSupportedPlatform();
  assertTrustedSecurityBinary();
  const [command, ...rest] = withoutSeparator(argv);
  const presentLocalFiles = auditLocalSensitiveFiles();
  if (command === "list") {
    if (rest.length !== 0) throw new Error(usage());
    printInventory();
    return 0;
  }
  if (command === "status") {
    if (rest.length !== 0) throw new Error(usage());
    printStatus();
    printLocalFileAudit(presentLocalFiles);
    return 0;
  }
  if (command === "audit-local") {
    if (rest.length !== 0) throw new Error(usage());
    printLocalFileAudit(presentLocalFiles);
    return 0;
  }
  if (command === "verify") {
    const target = rest[0] ?? "dev";
    if ((target !== "dev" && target !== "seed") || rest.length > 1) {
      throw new Error(usage());
    }
    const values = await collectKeychainValues(target);
    values.clear();
    process.stdout.write(`Keychain configuration for ${target} is complete and valid.\n`);
    return 0;
  }
  if (command === "set") {
    const arguments_ = withoutSeparator(rest);
    const name = arguments_[0];
    const replace = arguments_[1] === "--replace";
    if (
      name === undefined ||
      arguments_.length > (replace ? 2 : 1) ||
      (arguments_.length === 2 && !replace)
    ) {
      throw new Error(usage());
    }
    setKeychainItem(name, replace);
    process.stdout.write(`${name} stored in the local-development Keychain service.\n`);
    return 0;
  }
  if (command === "run") {
    const arguments_ = withoutSeparator(rest);
    const target = arguments_[0];
    if (target !== "dev" && target !== "seed") throw new Error(usage());
    return await runWithKeychainSecrets(
      target,
      withoutSeparator(arguments_.slice(1)),
    );
  }
  throw new Error(usage());
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
