import type { Hono } from "hono";
import { buildApp } from "../../app";
import type { Subscription } from "../../domain/billing/types";
import {
  parseTestsFile,
  serializeTestsFile,
  type BrowserTestTransferEntry,
} from "../../domain/browser_tests/transfer";
import type { NotificationChannel } from "../../domain/channels/types";
import type { User } from "../../domain/users/types";
import type { Role, Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1AuditRepo } from "../../infrastructure/db/audit_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1ChannelRepo } from "../../infrastructure/db/channel_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1SubscriptionRepo } from "../../infrastructure/db/subscription_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { encryptSecret } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

type Actor = "owner" | "member";
const NOW = Date.now();
const USERS: Record<Actor, User> = {
  owner: {
    id: "usr_transfer_owner",
    name: "Owner",
    email: "owner@transfer.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  member: {
    id: "usr_transfer_member",
    name: "Member",
    email: "member@transfer.test",
    passwordHash: "hash",
    emailVerifiedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  },
};
const ROLES: Record<Actor, Role> = { owner: "OWNER", member: "MEMBER" };
const WORKSPACE: Workspace = {
  id: "ws_transfer",
  name: "Transfer Workspace",
  slug: "transfer-workspace",
  timezone: "UTC",
  ownerUserId: USERS.owner.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_transfer_other",
  slug: "transfer-workspace-other",
};
const SUBSCRIPTION: Subscription = {
  id: "sub_transfer",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_transfer",
  providerSubscriptionId: "sub_provider_transfer",
  status: "ACTIVE",
  periodStart: 1,
  periodEnd: 9_999_999_999_999,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: 1,
  updatedAt: 1,
};
const CONFIG = {
  name: "Checkout",
  startUrl: "https://shop.example.com/checkout",
  instructions: "Complete checkout and verify the confirmation",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: ["ch_transfer"],
} as const;

function entry(
  overrides: Partial<BrowserTestTransferEntry> = {},
): BrowserTestTransferEntry {
  return { ...CONFIG, channelIds: [...CONFIG.channelIds], ...overrides };
}

function channel(
  id: string,
  workspaceId: string,
  encryptedConfig: string,
): NotificationChannel {
  return {
    id,
    workspaceId,
    name: id,
    type: "EMAIL",
    encryptedConfig,
    enabled: true,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USERS.owner.id,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("browser test export/import routes", () => {
  let app: Hono<AppEnv>;
  let clock: FixedClock;
  let tokens: Record<Actor, string>;
  let tests: D1BrowserTestRepo;
  let audits: D1AuditRepo;

  beforeEach(async () => {
    await freshDb();
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const user of Object.values(USERS)) await users.insert(user);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
    let sequence = 0;
    for (const actor of ["owner", "member"] as const) {
      sequence += 1;
      await members.insert({
        id: `mem_transfer_${sequence}`,
        workspaceId: WORKSPACE.id,
        userId: USERS[actor].id,
        role: ROLES[actor],
        invitedBy: actor === "owner" ? null : USERS.owner.id,
        joinedAt: sequence,
      });
    }
    const subscriptions = new D1SubscriptionRepo(bindings.DB);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    const channels = new D1ChannelRepo(bindings.DB);
    const encryptedEmail = await encryptSecret(
      JSON.stringify({ emails: ["ops@example.com"] }),
      config.encryptionKey,
    );
    await channels.insert(channel("ch_transfer", WORKSPACE.id, encryptedEmail));
    await channels.insert(
      channel("ch_other_workspace", OTHER_WORKSPACE.id, encryptedEmail),
    );
    tests = new D1BrowserTestRepo(bindings.DB);
    audits = new D1AuditRepo(bindings.DB);
    clock = new FixedClock(NOW);
    tokens = {
      owner: `Bearer ${await issueAccessToken(config, USERS.owner, clock)}`,
      member: `Bearer ${await issueAccessToken(config, USERS.member, clock)}`,
    };
    app = buildApp(bindings, { clock, ids: new FakeIds() });
  });

  async function create(
    config: Record<string, unknown> = CONFIG,
  ): Promise<{ id: string }> {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      {
        method: "POST",
        headers: {
          Authorization: tokens.owner,
          "content-type": "application/json",
        },
        body: JSON.stringify(config),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    return { id: body.data.id };
  }

  async function exportRequest(
    query = "",
    actor: Actor = "owner",
  ): Promise<Response> {
    return app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/export${query}`,
      { headers: { Authorization: tokens[actor] } },
    );
  }

  async function importRequest(
    body: string,
    actor: Actor = "owner",
  ): Promise<Response> {
    return app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/import`,
      { method: "POST", headers: { Authorization: tokens[actor] }, body },
    );
  }

  async function listedNames(): Promise<string[]> {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests`,
      { headers: { Authorization: tokens.owner } },
    );
    const body = (await response.json()) as { data: { name: string }[] };
    return body.data.map((test) => test.name);
  }

  it("exports workspace tests as YAML by default and JSON on demand", async () => {
    await create();
    await create({ ...CONFIG, name: "Login", channelIds: [] });
    const date = new Date(NOW).toISOString().slice(0, 10);

    const yaml = await exportRequest("", "member");
    expect(yaml.status).toBe(200);
    expect(yaml.headers.get("Content-Type")).toContain("text/yaml");
    expect(yaml.headers.get("Content-Disposition")).toBe(
      `attachment; filename="zenguy-tests-${WORKSPACE.slug}-${date}.yaml"`,
    );
    const file = parseTestsFile(await yaml.text());
    expect(file.version).toBe(1);
    expect(file.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          name: "Checkout",
          channelIds: ["ch_transfer"],
        }),
        expect.objectContaining({ name: "Login", channelIds: [] }),
      ]),
    );

    const json = await exportRequest("?format=json");
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Type")).toContain("application/json");
    expect(json.headers.get("Content-Disposition")).toBe(
      `attachment; filename="zenguy-tests-${WORKSPACE.slug}-${date}.json"`,
    );
    const parsed = JSON.parse(await json.text()) as { tests: unknown[] };
    expect(parsed.tests).toHaveLength(2);
  });

  it("imports new tests and upserts existing ones by id", async () => {
    const existing = await create();
    const foreign = {
      id: "bt_99999999999999999999999998",
      workspaceId: OTHER_WORKSPACE.id,
      name: "Foreign",
      startUrl: "https://foreign.example.com",
      instructions: "Stay untouched",
      device: "DESKTOP" as const,
      intervalHours: 6,
      maxRetries: 0,
      notifyOnRecovery: false,
      nextRunAt: NOW,
      createdBy: null,
      updatedBy: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    await tests.insert(foreign);

    const body = [
      "version: 1",
      "tests:",
      "  - name: Imported A",
      "    startUrl: https://shop.example.com/a",
      "    instructions: |-",
      "      Open the page",
      "      Check the title",
      "    device: MOBILE",
      "    intervalHours: 12",
      "    maxRetries: 1",
      "    notifyOnRecovery: false",
      "    channelIds: [ch_transfer]",
      `  - id: ${existing.id}`,
      "    name: Checkout renamed",
      "    startUrl: https://shop.example.com/checkout",
      "    instructions: Complete checkout and verify the confirmation",
      "    device: DESKTOP",
      "    intervalHours: 2",
      "    maxRetries: 2",
      "    notifyOnRecovery: true",
      "    channelIds: []",
      "  - id: bt_99999999999999999999999999",
      "    name: Imported C",
      "    startUrl: https://shop.example.com/c",
      "    instructions: Verify the page loads",
      "    device: DESKTOP",
      "    intervalHours: 24",
      "    maxRetries: 0",
      "    notifyOnRecovery: true",
      "    channelIds: []",
      `  - id: ${foreign.id}`,
      "    name: Imported D",
      "    startUrl: https://shop.example.com/d",
      "    instructions: Verify the page loads",
      "    device: DESKTOP",
      "    intervalHours: 24",
      "    maxRetries: 0",
      "    notifyOnRecovery: true",
      "    channelIds: []",
    ].join("\n");

    const response = await importRequest(body);
    expect(response.status).toBe(200);
    const importResult = (await response.json()) as {
      data: { created: number; updated: number; tests: { id: string; name: string }[] };
    };
    expect(importResult.data).toMatchObject({ created: 3, updated: 1 });
    expect(importResult.data.tests.map((test) => test.name)).toEqual([
      "Imported A",
      "Checkout renamed",
      "Imported C",
      "Imported D",
    ]);
    for (const test of importResult.data.tests) {
      expect(test.id).toMatch(/^bt_/);
    }

    await expect(listedNames()).resolves.toEqual(
      expect.arrayContaining([
        "Imported A",
        "Checkout renamed",
        "Imported C",
        "Imported D",
      ]),
    );

    const updated = await tests.findById(WORKSPACE.id, existing.id);
    expect(updated).toMatchObject({
      name: "Checkout renamed",
      intervalHours: 2,
      nextRunAt: NOW + 2 * 3_600_000,
      updatedBy: USERS.owner.id,
    });
    await expect(tests.getChannelIds(existing.id)).resolves.toEqual([]);

    // Ids from the file are never trusted: unknown and foreign ids become
    // fresh server-generated tests, and the other workspace stays untouched.
    expect(await tests.findById(WORKSPACE.id, "bt_99999999999999999999999999")).toBeNull();
    expect(await tests.findById(WORKSPACE.id, foreign.id)).toBeNull();
    await expect(tests.findById(OTHER_WORKSPACE.id, foreign.id)).resolves.toMatchObject({
      name: "Foreign",
    });

    const importedTest = (await tests.list(WORKSPACE.id)).find(
      (test) => test.name === "Imported A",
    );
    expect(importedTest).toMatchObject({
      instructions: "Open the page\nCheck the title",
      device: "MOBILE",
      createdBy: USERS.owner.id,
    });
    await expect(tests.getChannelIds(importedTest!.id)).resolves.toEqual([
      "ch_transfer",
    ]);

    const actions = (await audits.list(WORKSPACE.id, null, 50)).map(
      (entry) => entry.action,
    );
    expect(actions.filter((action) => action === "test.created")).toHaveLength(4);
    expect(actions.filter((action) => action === "test.updated")).toHaveLength(1);
  });

  it("re-importing an export updates every test and creates none", async () => {
    await create();
    await create({ ...CONFIG, name: "Login", channelIds: [] });
    const exported = await (await exportRequest()).text();

    const response = await importRequest(exported);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { created: 0, updated: 2 },
    });
    await expect(listedNames()).resolves.toHaveLength(2);
  });

  it("rejects the whole file when any entry is invalid", async () => {
    const body = JSON.stringify({
      version: 1,
      tests: [entry({ channelIds: [] }), entry({ intervalHours: 99 })],
    });
    const response = await importRequest(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "tests.1.intervalHours" }],
      },
    });
    await expect(listedNames()).resolves.toEqual([]);

    const unparseable = await importRequest("{ nope: [");
    expect(unparseable.status).toBe(400);
    await expect(unparseable.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR", details: [{ field: "file" }] },
    });
  });

  it("rejects channels that do not belong to the workspace", async () => {
    const body = JSON.stringify({
      version: 1,
      tests: [
        entry({ channelIds: ["ch_other_workspace"] }),
        entry({ name: "Valid", channelIds: [] }),
      ],
    });
    const response = await importRequest(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "tests.0.channelIds" }],
      },
    });
    await expect(listedNames()).resolves.toEqual([]);
  });

  it("forbids import for members without tests.manage", async () => {
    const body = serializeTestsFile([entry({ channelIds: [] })], "yaml");
    const response = await importRequest(body, "member");
    expect(response.status).toBe(403);
    await expect(listedNames()).resolves.toEqual([]);
  });

  it("rate limits imports per workspace", async () => {
    const body = serializeTestsFile([entry({ channelIds: [] })], "yaml");
    let blocked: Response | null = null;
    for (let i = 0; i < RATE_LIMITS.test_import.limit + 1; i += 1) {
      const response = await importRequest(body);
      if (response.status === 429) {
        blocked = response;
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(blocked).not.toBeNull();
    await expect(blocked!.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });
});
