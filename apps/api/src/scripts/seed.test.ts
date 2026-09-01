/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEncryptionKeyring,
  decryptSecret,
  type WorkspaceDataKeyRecord,
  type WorkspaceDataKeyStore,
  verifyPassword,
} from "../shared/crypto";

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
      `ENCRYPTION_KEY=${Buffer.alloc(32, 7).toString("base64")}\nENCRYPTION_KEY_ID=seed-test-key\n`,
      { encoding: "utf8", mode: 0o600 },
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
      "workspace_invitations",
      "workspace_api_keys",
      "subscriptions",
      "workspace_secrets",
      "notification_channels",
      "notification_deliveries",
      "browser_tests",
      "browser_test_channels",
      "test_runs",
      "test_attempts",
      "run_steps",
      "uptime_monitors",
      "uptime_monitor_channels",
      "uptime_checks",
      "incidents",
      "incident_events",
      "audit_logs",
    ]) {
      expect(sql).toContain(`DELETE FROM ${table};`);
      expect(sql.match(new RegExp(`INSERT INTO ${table} \\(`, "gu"))?.length).toBeGreaterThan(0);
    }
    expect(sql).toContain("DELETE FROM users;");
    expect(sql).toContain("DELETE FROM workspaces;");
    expect(sql).toContain("DELETE FROM subscription_grants;");
    expect(sql).toContain("owner@example.com");
    expect(sql).not.toContain("marcos@aguayo.es");
    expect(sql).toContain("ana@zenguy.dev");
    expect(sql).toContain("luis@zenguy.dev");
    expect(sql).toContain("marta@zenguy.dev");
    expect(sql).toContain("diego@zenguy.dev");
    expect(sql).toContain("noelia@zenguy.dev");
    expect(sql).toContain("Atlas Demo");
    expect(sql).toContain("Europe/Madrid");
    expect(sql).toContain("'ADMIN'");
    expect(sql).toContain("'MEMBER'");
    expect(sql).toContain("Homepage smoke");
    expect(sql).toContain("Profile update");
    expect(sql).toContain("Login form");
    expect(sql).toContain("Search filters");
    expect(sql).toContain("Help center");
    expect(sql).toContain("Session timeout");
    expect(sql).not.toMatch(/Signup flow|Pricing page|Billing API/iu);
    expect(sql).toContain("INSERT INTO test_runs (");
    expect(sql).toContain("Homepage beat");
    expect(sql).toContain("API beat");
    expect(sql).toContain("Webhooks receiver");
    expect(sql).toContain("Auth service");
    expect(sql).toContain("'grant'");
    expect(sql).toContain("'EMAIL'");
    expect(sql).toContain("'SLACK'");
    expect(sql).toContain("'DISCORD'");
    expect(sql).toContain("'SMS'");
    expect(sql).toContain("'OPEN'");
    expect(sql).toContain("'RESOLVED'");
    expect(sql).toContain("'TIMEOUT'");
    expect(sql).toContain("'SYSTEM_ERROR'");
    expect(sql).toContain("'DOWN'");
    expect(sql).toContain("'FAILED'");
    expect((sql.match(/'bt_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(12);
    expect((sql.match(/'run_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(80);
    expect((sql.match(/'mon_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(10);
    expect((sql.match(/'chk_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(200);
    expect((sql.match(/'inc_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((sql.match(/'aud_seed_/gu) ?? []).length).toBeGreaterThanOrEqual(20);
    expect(sql).not.toContain("seed-demo-token");
    expect(sql).not.toContain("demo-secret-value");
    expect(sql).not.toContain("zenguy-db");

    const passwordHash = sql.match(
      /pbkdf2-sha256\$v1\$600000\$[^']+/u,
    )?.[0];
    expect(passwordHash).toBeDefined();
    await expect(
      verifyPassword("Local-demo-password-2026!", passwordHash ?? ""),
    ).resolves.toBe(true);
    const dataKeyMatch = sql.match(
      /INSERT INTO workspace_data_encryption_keys .* VALUES \('ws_seed_aguayo', '(dek-[A-Za-z0-9_-]{24})', 1, 'seed-test-key', 1, '(w1:seed-test-key:[^']+)', 1, (\d+), \d+, NULL\);/u,
    );
    const dataKeyId = dataKeyMatch?.[1];
    const wrappedKey = dataKeyMatch?.[2];
    const createdAt = Number(dataKeyMatch?.[3]);
    expect(dataKeyId).toBeDefined();
    expect(wrappedKey).toBeDefined();
    const encryptedDemo = sql.match(
      /'sec_seed_demo', 'ws_seed_aguayo', 'DEMO_TOKEN', '(v4:dek-[A-Za-z0-9_-]{24}:[^']+)'/u,
    )?.[1];
    expect(encryptedDemo).toBeDefined();
    const dataKeyRecord: WorkspaceDataKeyRecord = {
      workspaceId: "ws_seed_aguayo",
      id: dataKeyId ?? "",
      generation: 1,
      wrappingKeyId: "seed-test-key",
      wrapVersion: 1,
      wrappedKey: wrappedKey ?? "",
      active: true,
      createdAt,
      retiredAt: null,
    };
    const workspaceDataKeys = {
      findActive: async (workspaceId) =>
        workspaceId === dataKeyRecord.workspaceId ? dataKeyRecord : null,
      findById: async (workspaceId, id) =>
        workspaceId === dataKeyRecord.workspaceId && id === dataKeyRecord.id
          ? dataKeyRecord
          : null,
      insertActiveIfAbsent: async () => dataKeyRecord,
      activate: async () => null,
      replaceWrappedKeyIfUnchanged: async () => false,
    } satisfies WorkspaceDataKeyStore;
    await expect(
      decryptSecret(
        encryptedDemo ?? "",
        createEncryptionKeyring(
          {
            id: "seed-test-key",
            key: new Uint8Array(32).fill(7),
          },
          [],
          { workspaceDataKeys },
        ),
        {
          type: "workspace_secret",
          workspaceId: "ws_seed_aguayo",
          recordId: "sec_seed_demo",
        },
      ),
    ).resolves.toBe("seed-demo-token");
  });

  it.each([
    { arguments: ["--remote"] },
    { arguments: ["--remote", "--env", "staging", "--allow-remote", "--confirm-staging"] },
    { arguments: ["--remote", "--env", "production", "--allow-remote", "--confirm-staging"] },
  ])("refuses every remote seed invocation: $arguments", ({ arguments: arguments_ }) => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--print-command", ...arguments_],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Remote seed is disabled");
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

  it("targets only the explicitly local database by default", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--print-command"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      executable: process.execPath,
      arguments: [
        expect.stringMatching(/node_modules\/wrangler\/bin\/wrangler\.js$/u),
        "d1",
        "execute",
        "zenguy-local-db",
        "--local",
        "--file",
        "/dev/fd/3",
      ],
    });
  });

  it("requires an explicit private vars source and refuses broad permissions", () => {
    const missing = spawnSync(process.execPath, [SCRIPT, "--dry-run"], {
      encoding: "utf8",
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Keychain-backed package command");

    chmodSync(varsFile, 0o644);
    const broad = spawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--vars-file", varsFile],
      { encoding: "utf8" },
    );
    expect(broad.status).toBe(1);
    expect(broad.stderr).toContain("must use mode 0600");
  });
});
