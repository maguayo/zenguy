import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const WRANGLER_ENTRYPOINT = path.join(
  ADMIN_DIRECTORY,
  "node_modules/wrangler/bin/wrangler.js",
);
const REQUIRED_SECRET_NAMES = Object.freeze(["ADMIN_USER_IDS"]);
const MAX_OUTPUT_BYTES = 64 * 1024;

export function parseSecretList(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Wrangler returned an invalid admin secret inventory");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (binding) =>
        binding === null ||
        typeof binding !== "object" ||
        typeof binding.name !== "string" ||
        binding.type !== "secret_text" ||
        Object.hasOwn(binding, "value") ||
        Object.hasOwn(binding, "text") ||
        Object.hasOwn(binding, "key_base64") ||
        Object.hasOwn(binding, "key_jwk"),
    )
  ) {
    throw new Error("Wrangler returned an invalid admin secret inventory");
  }
  if (new Set(parsed.map(({ name }) => name)).size !== parsed.length) {
    throw new Error("Wrangler returned an invalid admin secret inventory");
  }
  return new Set(parsed.map(({ name }) => name));
}

export function missingRequiredSecrets(available) {
  return REQUIRED_SECRET_NAMES.filter((name) => !available.has(name));
}

function main() {
  if (process.argv.length !== 2) {
    throw new Error("The admin secret preflight does not accept an environment or value");
  }
  const output = execFileSync(
    process.execPath,
    [
      WRANGLER_ENTRYPOINT,
      "secret",
      "list",
      "--config",
      "wrangler.jsonc",
      "--format",
      "json",
    ],
    {
      cwd: ADMIN_DIRECTORY,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    },
  );
  const missing = missingRequiredSecrets(parseSecretList(output));
  if (missing.length > 0) {
    throw new Error(
      `Remote production admin Worker is missing required bindings: ${missing.join(", ")}`,
    );
  }
  console.log(
    `Remote production admin Worker has all ${REQUIRED_SECRET_NAMES.length} required secret bindings`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Admin secret preflight failed");
    process.exitCode = 1;
  }
}
