import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest, TestRun } from "../../domain/browser_tests/types";
import type { NotificationChannel } from "../../domain/channels/types";
import type { WorkspaceSecret } from "../../domain/secrets/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import {
  MAX_ACTIVE_RUNS_GLOBAL,
  MAX_ACTIVE_RUNS_PER_OWNER,
  MAX_ACTIVE_RUNS_PER_USER,
  MAX_ACTIVE_RUNS_PER_WORKSPACE,
  MAX_BROWSER_TESTS_PER_WORKSPACE,
  MAX_CHANNELS_PER_WORKSPACE,
  MAX_DAILY_RUNS_GLOBAL,
  MAX_DAILY_RUNS_PER_OWNER,
  MAX_DAILY_RUNS_PER_USER,
  MAX_DAILY_RUNS_PER_WORKSPACE,
  MAX_MONTHLY_RUNS_GLOBAL,
  MAX_MONTHLY_RUNS_PER_OWNER,
  MAX_MONTHLY_RUNS_PER_USER,
  MAX_MONTHLY_RUNS_PER_WORKSPACE,
  MAX_SECRETS_PER_WORKSPACE,
} from "../../shared/constants";
import { encryptTestValue, freshDb, testEnv } from "../../test/helpers";
import { D1BrowserTestRepo } from "./browser_test_repo";
import { D1ChannelRepo } from "./channel_repo";
import { D1RunRepo } from "./run_repo";
import { D1SecretRepo } from "./secret_repo";
import { D1SubscriptionRepo } from "./subscription_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const USER: User = {
  id: "usr_limit",
  name: "Limit Owner",
  email: "limit@example.com",
  passwordHash: "hash",
  emailVerifiedAt: NOW,
  authVersion: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function workspace(index: number, ownerUserId = USER.id): Workspace {
  return {
    id: `ws_limit_${ownerUserId}_${index}`,
    name: `Workspace ${index}`,
    slug: `workspace-${ownerUserId}-${index}`,
    timezone: "UTC",
    ownerUserId,
    createdAt: NOW + index,
    updatedAt: NOW + index,
    deletedAt: null,
  };
}

async function setRunCostLimits(
  overrides: Partial<{
    activeUser: number;
    activeGlobal: number;
    dailyWorkspace: number;
    dailyUser: number;
    dailyOwner: number;
    dailyGlobal: number;
    monthlyWorkspace: number;
    monthlyUser: number;
    monthlyOwner: number;
    monthlyGlobal: number;
  }>,
): Promise<void> {
  await testEnv()
    .DB.prepare(
      `UPDATE run_cost_limits
       SET max_active_runs_per_user = ?,
           max_active_runs_global = ?,
           max_daily_runs_per_workspace = ?,
           max_daily_runs_per_user = ?,
           max_daily_runs_per_owner = ?,
           max_daily_runs_global = ?,
           max_monthly_runs_per_workspace = ?,
           max_monthly_runs_per_user = ?,
           max_monthly_runs_per_owner = ?,
           max_monthly_runs_global = ?
       WHERE id = 1`,
    )
    .bind(
      overrides.activeUser ?? MAX_ACTIVE_RUNS_PER_USER,
      overrides.activeGlobal ?? MAX_ACTIVE_RUNS_GLOBAL,
      overrides.dailyWorkspace ?? MAX_DAILY_RUNS_PER_WORKSPACE,
      overrides.dailyUser ?? MAX_DAILY_RUNS_PER_USER,
      overrides.dailyOwner ?? MAX_DAILY_RUNS_PER_OWNER,
      overrides.dailyGlobal ?? MAX_DAILY_RUNS_GLOBAL,
      overrides.monthlyWorkspace ?? MAX_MONTHLY_RUNS_PER_WORKSPACE,
      overrides.monthlyUser ?? MAX_MONTHLY_RUNS_PER_USER,
      overrides.monthlyOwner ?? MAX_MONTHLY_RUNS_PER_OWNER,
      overrides.monthlyGlobal ?? MAX_MONTHLY_RUNS_GLOBAL,
    )
    .run();
}

function run(
  index: number,
  workspaceId: string,
  status: TestRun["status"] = "PASSED",
): TestRun {
  return {
    id: `run_limit_${workspaceId}_${index}`,
    workspaceId,
    browserTestId: null,
    source: "VALIDATION",
    status,
    snapshot: {
      name: "Quota check",
      startUrl: "https://example.com",
      instructions: "Check the page",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 0,
      notifyOnRecovery: false,
      channelIds: [],
      viewport: {
        width: 1440,
        height: 900,
      },
      modelName: "test-model",
      runnerVersion: "test-runner",
    },
    scheduledFor: null,
    queuedAt: NOW + index,
    startedAt: null,
    finishedAt: status === "PASSED" ? NOW + index + 1 : null,
    durationMs: status === "PASSED" ? 1 : null,
    attemptCount: 0,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: USER.id,
    incidentId: null,
    createdAt: NOW + index,
  };
}

function browserTest(index: number, workspaceId: string): BrowserTest {
  return {
    id: `bt_limit_${workspaceId}_${index}`,
    workspaceId,
    name: `Limit test ${index}`,
    startUrl: "https://example.com",
    instructions: "Check the page",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: false,
    nextRunAt: NOW,
    createdBy: USER.id,
    updatedBy: USER.id,
    createdAt: NOW + index,
    updatedAt: NOW + index,
    deletedAt: null,
  };
}

async function secret(
  index: number,
  workspaceId: string,
): Promise<WorkspaceSecret> {
  const id = `sec_limit_${workspaceId}_${index}`;
  return {
    id,
    workspaceId,
    key: `LIMIT_SECRET_${index}`,
    encryptedValue: await encryptTestValue({
      type: "workspace_secret",
      workspaceId,
      recordId: id,
    }),
    encryptionVersion: 4,
    allowedDomains: ["example.com"],
    description: null,
    createdBy: USER.id,
    createdAt: NOW + index,
    updatedAt: NOW + index,
  };
}

async function channel(
  index: number,
  workspaceId: string,
): Promise<NotificationChannel> {
  const id = `ch_limit_${workspaceId}_${index}`;
  return {
    id,
    workspaceId,
    name: `Limit channel ${index}`,
    type: "EMAIL",
    encryptedConfig: await encryptTestValue({
      type: "notification_channel",
      workspaceId,
      recordId: id,
    }),
    enabled: true,
    isDefault: false,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: USER.id,
    createdAt: NOW + index,
    updatedAt: NOW + index,
  };
}

describe("atomic security limits", () => {
  beforeEach(async () => {
    await freshDb();
    await new D1UserRepo(testEnv().DB).insert(USER);
  });

  it("allows several workspaces but atomically caps new ownership at three", async () => {
    const repo = new D1WorkspaceRepo(testEnv().DB);
    await Promise.all([0, 1, 2].map((index) => repo.insert(workspace(index))));

    await expect(repo.insert(workspace(3))).rejects.toThrow(
      "ZENGUY_OWNED_WORKSPACE_CAP",
    );
    await repo.softDelete(workspace(0).id, NOW + 10);
    await expect(repo.insert(workspace(3))).resolves.toBeUndefined();
  });

  it("keeps the 300-run allowance per workspace and applies the owner safety cap separately", async () => {
    await setRunCostLimits({ monthlyOwner: 602 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const subscriptions = new D1SubscriptionRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(1);
    const third = workspace(2);
    await workspaces.insert(first);
    await workspaces.insert(second);
    await workspaces.insert(third);
    const free: Subscription = {
      id: "sub_limit",
      workspaceId: first.id,
      provider: "internal",
      source: "free",
      providerCustomerId: null,
      providerSubscriptionId: null,
      status: "ACTIVE",
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await subscriptions.upsertByWorkspace(free);
    await subscriptions.upsertByWorkspace({
      ...free,
      id: "sub_limit_second",
      workspaceId: second.id,
    });
    for (let index = 0; index <= 300; index += 1) {
      await runs.insert(run(index, first.id));
      await runs.insert(run(index, second.id));
    }
    await expect(runs.insert(run(0, third.id))).rejects.toThrow(
      "ZENGUY_OWNER_MONTHLY_RUN_CAP",
    );
    const ownerCounter = await testEnv()
      .DB.prepare(
        `SELECT run_count FROM run_quota_counters
         WHERE scope_kind = 'OWNER' AND scope_id = ? AND window_kind = 'MONTH'`,
      )
      .bind(USER.id)
      .first<{ run_count: number }>();
    expect(ownerCounter?.run_count).toBe(602);
  });

  it("atomically caps active runs per workspace and owner", async () => {
    await setRunCostLimits({ activeUser: MAX_ACTIVE_RUNS_PER_OWNER + 1 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const subscriptions = new D1SubscriptionRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(1);
    const third = workspace(2);
    for (const current of [first, second, third]) {
      await workspaces.insert(current);
      await subscriptions.upsertByWorkspace({
        id: `sub_active_${current.id}`,
        workspaceId: current.id,
        provider: "paddle",
        source: "paddle",
        providerCustomerId: `ctm_${current.id}`,
        providerSubscriptionId: `provider_${current.id}`,
        status: "ACTIVE",
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        cancelAtPeriodEnd: false,
        updatePaymentUrl: null,
        cancelUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    for (let index = 0; index < MAX_ACTIVE_RUNS_PER_WORKSPACE; index += 1) {
      await runs.insert(run(index, first.id, "QUEUED"));
    }
    await expect(
      runs.insert(run(MAX_ACTIVE_RUNS_PER_WORKSPACE, first.id, "QUEUED")),
    ).rejects.toThrow("ZENGUY_WORKSPACE_ACTIVE_RUN_CAP");

    for (
      let index = 0;
      index < MAX_ACTIVE_RUNS_PER_OWNER - MAX_ACTIVE_RUNS_PER_WORKSPACE;
      index += 1
    ) {
      await runs.insert(run(index, second.id, "QUEUED"));
    }
    await expect(runs.insert(run(0, third.id, "QUEUED"))).rejects.toThrow(
      "ZENGUY_OWNER_ACTIVE_RUN_CAP",
    );
  });

  it("atomically caps active runs across workspaces for one triggering user", async () => {
    await setRunCostLimits({ activeUser: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(0, "usr_other_owner");
    await workspaces.insert(first);
    await workspaces.insert(second);

    await runs.insert(run(0, first.id, "QUEUED"));
    await runs.insert(run(0, second.id, "QUEUED"));
    await expect(runs.insert(run(1, second.id, "QUEUED"))).rejects.toThrow(
      "ZENGUY_USER_ACTIVE_RUN_CAP",
    );
  });

  it("atomically applies a platform-wide active-run circuit breaker", async () => {
    await setRunCostLimits({ activeGlobal: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(0, "usr_other_owner");
    const third = workspace(0, "usr_third_owner");
    for (const current of [first, second, third]) await workspaces.insert(current);

    await runs.insert({ ...run(0, first.id, "QUEUED"), triggeredByUserId: "usr_a" });
    await runs.insert({ ...run(0, second.id, "QUEUED"), triggeredByUserId: "usr_b" });
    await expect(
      runs.insert({ ...run(0, third.id, "QUEUED"), triggeredByUserId: "usr_c" }),
    ).rejects.toThrow("ZENGUY_GLOBAL_ACTIVE_RUN_CAP");
  });

  it("atomically caps calendar-day runs per workspace", async () => {
    await setRunCostLimits({ dailyWorkspace: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const current = workspace(0);
    await workspaces.insert(current);

    await runs.insert(run(0, current.id));
    await runs.insert(run(1, current.id));
    await expect(runs.insert(run(2, current.id))).rejects.toThrow(
      "ZENGUY_WORKSPACE_DAILY_RUN_CAP",
    );
  });

  it("atomically caps calendar-day runs across workspaces for one user", async () => {
    await setRunCostLimits({ dailyUser: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(0, "usr_other_owner");
    await workspaces.insert(first);
    await workspaces.insert(second);

    await runs.insert(run(0, first.id));
    await runs.insert(run(0, second.id));
    await expect(runs.insert(run(1, second.id))).rejects.toThrow(
      "ZENGUY_USER_DAILY_RUN_CAP",
    );
  });

  it("atomically caps calendar-day runs across an owner's workspaces", async () => {
    await setRunCostLimits({ dailyOwner: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(1);
    await workspaces.insert(first);
    await workspaces.insert(second);

    await runs.insert({ ...run(0, first.id), triggeredByUserId: "usr_a" });
    await runs.insert({ ...run(0, second.id), triggeredByUserId: "usr_b" });
    await expect(
      runs.insert({ ...run(1, second.id), triggeredByUserId: "usr_c" }),
    ).rejects.toThrow("ZENGUY_OWNER_DAILY_RUN_CAP");
  });

  it("atomically applies a platform-wide calendar-day circuit breaker", async () => {
    await setRunCostLimits({ dailyGlobal: 2 });
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const first = workspace(0);
    const second = workspace(0, "usr_other_owner");
    const third = workspace(0, "usr_third_owner");
    for (const current of [first, second, third]) await workspaces.insert(current);

    await runs.insert({ ...run(0, first.id), triggeredByUserId: "usr_a" });
    await runs.insert({ ...run(0, second.id), triggeredByUserId: "usr_b" });
    await expect(
      runs.insert({ ...run(0, third.id), triggeredByUserId: "usr_c" }),
    ).rejects.toThrow("ZENGUY_GLOBAL_DAILY_RUN_CAP");
  });

  it.each([
    {
      marker: "ZENGUY_WORKSPACE_MONTHLY_RUN_CAP",
      override: { monthlyWorkspace: 2 },
      scope: "workspace",
    },
    {
      marker: "ZENGUY_USER_MONTHLY_RUN_CAP",
      override: { monthlyUser: 2 },
      scope: "user",
    },
    {
      marker: "ZENGUY_OWNER_MONTHLY_RUN_CAP",
      override: { monthlyOwner: 2 },
      scope: "owner",
    },
    {
      marker: "ZENGUY_GLOBAL_MONTHLY_RUN_CAP",
      override: { monthlyGlobal: 2 },
      scope: "global",
    },
  ] as const)("atomically caps calendar-month runs per $scope", async ({ marker, override, scope }) => {
    await setRunCostLimits(override);
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const runs = new D1RunRepo(testEnv().DB);
    const sameOwner = scope === "owner";
    const first = workspace(0);
    const second = workspace(1, sameOwner ? USER.id : "usr_other_owner");
    const third = workspace(2, sameOwner ? USER.id : "usr_third_owner");
    for (const current of [first, second, third]) await workspaces.insert(current);

    const workspaceIds =
      scope === "workspace"
        ? [first.id, first.id, first.id]
        : [first.id, second.id, third.id];
    const actorIds =
      scope === "user"
        ? [USER.id, USER.id, USER.id]
        : ["usr_a", "usr_b", "usr_c"];
    await runs.insert({
      ...run(0, workspaceIds[0] ?? first.id),
      triggeredByUserId: actorIds[0] ?? "usr_a",
    });
    await runs.insert({
      ...run(1, workspaceIds[1] ?? second.id),
      triggeredByUserId: actorIds[1] ?? "usr_b",
    });
    await expect(
      runs.insert({
        ...run(2, workspaceIds[2] ?? third.id),
        triggeredByUserId: actorIds[2] ?? "usr_c",
      }),
    ).rejects.toThrow(marker);
  });

  it("caps live browser tests per workspace and releases capacity on soft delete", async () => {
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const tests = new D1BrowserTestRepo(testEnv().DB);
    const current = workspace(0);
    const other = workspace(1);
    await workspaces.insert(current);
    await workspaces.insert(other);
    for (let index = 0; index < MAX_BROWSER_TESTS_PER_WORKSPACE; index += 1) {
      await tests.insert(browserTest(index, current.id));
    }
    await expect(
      tests.insert(browserTest(MAX_BROWSER_TESTS_PER_WORKSPACE, current.id)),
    ).rejects.toThrow("ZENGUY_COLLECTION_CAP_BROWSER_TESTS");
    await expect(tests.insert(browserTest(0, other.id))).resolves.toBeUndefined();

    await tests.softDelete(browserTest(0, current.id).id, NOW + 10_000);
    await expect(
      tests.insert(browserTest(MAX_BROWSER_TESTS_PER_WORKSPACE, current.id)),
    ).resolves.toBeUndefined();
  });

  it("caps secrets per workspace", async () => {
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const secrets = new D1SecretRepo(testEnv().DB);
    const current = workspace(0);
    const other = workspace(1);
    await workspaces.insert(current);
    await workspaces.insert(other);
    for (let index = 0; index < MAX_SECRETS_PER_WORKSPACE; index += 1) {
      await secrets.insert(await secret(index, current.id));
    }
    await expect(
      secrets.insert(await secret(MAX_SECRETS_PER_WORKSPACE, current.id)),
    ).rejects.toThrow("ZENGUY_COLLECTION_CAP_SECRETS");
    await expect(
      secrets.insert(await secret(0, other.id)),
    ).resolves.toBeUndefined();
  });

  it("caps channels per workspace", async () => {
    const workspaces = new D1WorkspaceRepo(testEnv().DB);
    const channels = new D1ChannelRepo(testEnv().DB);
    const current = workspace(0);
    const other = workspace(1);
    await workspaces.insert(current);
    await workspaces.insert(other);
    for (let index = 0; index < MAX_CHANNELS_PER_WORKSPACE; index += 1) {
      await channels.insert(await channel(index, current.id));
    }
    await expect(
      channels.insert(await channel(MAX_CHANNELS_PER_WORKSPACE, current.id)),
    ).rejects.toThrow("ZENGUY_COLLECTION_CAP_CHANNELS");
    await expect(
      channels.insert(await channel(0, other.id)),
    ).resolves.toBeUndefined();
  });
});
