import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SEED_SCRIPT = path.join(SCRIPT_DIRECTORY, "seed.mjs");
const STAGING_FLAGS = [
  "--remote",
  "--env",
  "staging",
  "--allow-remote",
  "--confirm-staging",
];

function parsePassthrough(argv) {
  const extra = [];
  for (const argument of argv) {
    if (argument === "--") continue;
    const lower = argument.toLowerCase();
    if (lower === "production" || lower.includes("zenguy-db")) {
      throw new Error("Staging reseed refuses production and zenguy-db");
    }
    extra.push(argument);
  }
  return extra;
}

export function stagingSeedArguments(argv = []) {
  return [SEED_SCRIPT, ...STAGING_FLAGS, ...parsePassthrough(argv)];
}

async function main() {
  const arguments_ = stagingSeedArguments(process.argv.slice(2));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: path.resolve(SCRIPT_DIRECTORY, ".."),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            signal === null
              ? `Seed exited with code ${String(code)}`
              : `Seed was terminated by ${signal}`,
          ),
        );
      }
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Staging reseed failed: ${message}\n`);
    process.exitCode = 1;
  });
}
