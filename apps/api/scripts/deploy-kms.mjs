import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_ENVIRONMENTS = new Set(["staging", "production"]);
const environment = process.argv[2];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, onSuccess) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.once("error", (error) => {
    console.error(`Unable to start release command: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      console.error(`Release command exited after signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    if (code !== 0) {
      process.exitCode = code ?? 1;
      return;
    }
    onSuccess?.();
  });
}

if (!ALLOWED_ENVIRONMENTS.has(environment)) {
  console.error(
    "Refusing an unscoped KMS deploy. Use deploy:kms:staging or deploy:kms:production.",
  );
  process.exitCode = 2;
} else {
  // This metadata-only gate must pass before Wrangler can upload a new KMS
  // version. Wrangler preserves both secret_text and secret_key bindings.
  run(
    process.execPath,
    [path.join(scriptDirectory, "verify-remote-secrets.mjs"), environment],
    () => {
      run("pnpm", [
        "exec",
        "wrangler",
        "deploy",
        "--config",
        "wrangler.kms.jsonc",
        "--env",
        environment,
      ]);
    },
  );
}
