/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const API = path.join(ROOT, "apps/api");
const WORKFLOW = path.join(ROOT, ".github/workflows/staging.yml");
const RESEED = path.join(API, "scripts/reseed-staging.mjs");
const SEED = path.join(API, "scripts/seed.mjs");

function stagingSeedArguments(argv: string[] = []): string[] {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { stagingSeedArguments } from ${JSON.stringify(RESEED)}; process.stdout.write(JSON.stringify(stagingSeedArguments(${JSON.stringify(argv)})));`,
    ],
    { encoding: "utf8", cwd: API },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "stagingSeedArguments failed");
  }
  return JSON.parse(result.stdout) as string[];
}

describe("staging wipe and reseed automation", () => {
  it("only runs on the staging branch and never names the production database", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    const reseed = readFileSync(RESEED, "utf8");
    const seed = readFileSync(SEED, "utf8");

    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- staging");
    expect(workflow).toContain("pnpm db:migrate:staging");
    expect(workflow).toContain("pnpm seed:staging");
    expect(workflow).not.toContain("zenguy-db");
    expect(workflow).not.toContain("db:migrate:production");
    expect(workflow).not.toContain("deploy:production");
    expect(reseed).not.toMatch(/d1 execute zenguy-db/u);
    expect(seed).toContain('STAGING_DATABASE = "zenguy-staging-db"');
  });

  it("hardcodes the staging confirmation flags and rejects production targets", () => {
    const arguments_ = stagingSeedArguments([]);
    expect(arguments_).toEqual(
      expect.arrayContaining([
        "--remote",
        "--env",
        "staging",
        "--allow-remote",
        "--confirm-staging",
      ]),
    );
    expect(arguments_.join(" ")).not.toContain("zenguy-db");
    expect(arguments_.join(" ")).not.toContain("production");
    expect(() => stagingSeedArguments(["--env", "production"])).toThrow(
      /production/u,
    );
    expect(() => stagingSeedArguments(["zenguy-db"])).toThrow(/zenguy-db/u);
  });
});
