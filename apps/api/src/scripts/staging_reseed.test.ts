/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const API = path.join(ROOT, "apps/api");
const WORKFLOW = path.join(ROOT, ".github/workflows/staging.yml");
const RESEED = path.join(API, "scripts/reseed-staging.mjs");
const PACKAGE = path.join(API, "package.json");

describe("staging fixture isolation", () => {
  it("deploys staging without publishing deterministic local fixtures", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    const manifest = JSON.parse(readFileSync(PACKAGE, "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- staging");
    expect(workflow).toContain("pnpm db:migrate:staging");
    expect(workflow).not.toMatch(
      /seed|fixture|abc123456|marcos@aguayo\.es|owner@example\.com|Local-demo-password-2026!/iu,
    );
    expect(workflow).not.toContain("zenguy-db");
    expect(workflow).not.toContain("db:migrate:production");
    expect(workflow).not.toContain("deploy:production");
    expect(manifest.scripts["seed:staging"]).toBeUndefined();
    expect(existsSync(RESEED)).toBe(false);
  });
});
