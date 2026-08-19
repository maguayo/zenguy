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

  it("refuses --remote without the explicit allow flag", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--remote", "--vars-file", varsFile],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Refusing to seed remote D1 without the explicit --allow-remote flag",
    );
  });
});
