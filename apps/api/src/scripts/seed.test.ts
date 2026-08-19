/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPassword } from "../shared/crypto";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/seed.mjs", import.meta.url),
);

describe("seed script", () => {
  let directory = "";
  let varsFile = "";

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "zenguy-seed-"));
    varsFile = path.join(directory, ".dev.vars");
    writeFileSync(
      varsFile,
      `ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString("base64")}\n`,
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("prints complete idempotent SQL on --dry-run with compatible crypto", async () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--", "--dry-run", "--vars-file", varsFile],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const sql = result.stdout;
    for (const table of [
      "users",
      "workspaces",
      "workspace_members",
      "subscriptions",
      "workspace_secrets",
      "notification_channels",
      "browser_tests",
      "browser_test_channels",
      "uptime_monitors",
      "uptime_monitor_channels",
    ]) {
      expect(sql.match(new RegExp(`INSERT INTO ${table} \\(`, "gu"))).toHaveLength(1);
    }
    expect(sql).toContain("DELETE FROM users WHERE id LIKE 'seed_%'");
    expect(sql).toContain("DELETE FROM users WHERE email = 'demo@zenguy.dev'");
    expect(sql).toContain("demo@zenguy.dev");
    expect(sql).toContain("Demo Workspace");
    expect(sql).toContain("Europe/Madrid");
    expect(sql).toContain("DEMO_TOKEN");
    expect(sql).toContain("*.example.com");
    expect(sql).toContain("Example smoke");
    expect(sql).toContain("Example uptime");
    expect(sql).not.toContain("demo-secret-value");
    expect(sql.match(/seed_[0-9A-HJKMNP-TV-Z]{26}/gu)?.length).toBeGreaterThan(20);

    const passwordHash = sql.match(/pbkdf2\$100000\$[^']+/u)?.[0];
    expect(passwordHash).toBeDefined();
    await expect(
      verifyPassword("Password123!", passwordHash ?? ""),
    ).resolves.toBe(true);
  });

  it.each([
    {
      name: "an implicit target",
      arguments: ["--remote", "--allow-remote", "--confirm-staging"],
      message: "Remote seed target must be explicitly set with --env staging",
    },
    {
      name: "the production environment",
      arguments: [
        "--remote",
        "--env",
        "production",
        "--allow-remote",
        "--confirm-staging",
      ],
      message: "production is never supported",
    },
    {
      name: "only the allow flag",
      arguments: ["--remote", "--env", "staging", "--allow-remote"],
      message: "requires both --allow-remote and --confirm-staging",
    },
    {
      name: "only the staging confirmation",
      arguments: ["--remote", "--env", "staging", "--confirm-staging"],
      message: "requires both --allow-remote and --confirm-staging",
    },
  ])("refuses remote seeding with $name", ({ arguments: arguments_, message }) => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--print-command", ...arguments_],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });

  it("rejects a remote confirmation flag when remote mode is absent", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--print-command", "--allow-remote"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "--allow-remote, and --confirm-staging are valid only with --remote",
    );
  });

  it("uses only the explicit staging database for an approved remote seed", () => {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--print-command",
        "--remote",
        "--env",
        "staging",
        "--allow-remote",
        "--confirm-staging",
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      executable: "npx",
      arguments: [
        "wrangler",
        "d1",
        "execute",
        "zenguy-staging-db",
        "--remote",
        "--env",
        "staging",
        "--file",
        "scripts/.seed.generated.sql",
      ],
    });
    expect(result.stdout).not.toContain('"zenguy-db"');
  });

  it("keeps the production-named database local by default", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--print-command"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      arguments: [
        "wrangler",
        "d1",
        "execute",
        "zenguy-db",
        "--local",
        "--file",
        "scripts/.seed.generated.sql",
      ],
    });
  });
});
