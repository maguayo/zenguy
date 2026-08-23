import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import {
  FakeBrowserTestRepo,
  FakeRunRepo,
} from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeSubscriptionRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import { CreateRun } from "./create_run";

const NOW = 1_700_000_000_000;
const WORKSPACE: Workspace = {
  id: "ws_irreversible",
  name: "Irreversible",
  slug: "irreversible",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SUBSCRIPTION: Subscription = {
  id: "sub_irreversible",
  workspaceId: WORKSPACE.id,
  provider: "paddle",
  providerCustomerId: "ctm_irreversible",
  providerSubscriptionId: "sub_provider_irreversible",
  status: "ACTIVE",
  periodStart: NOW - 1,
  periodEnd: NOW + 10_000,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const SCOPE = {
  kind: "HTTP" as const,
  method: "DELETE" as const,
  origin: "https://staging.example.com",
  path: "/test-records/one",
  maxUses: 1,
};
const TEST: BrowserTest = {
  id: "bt_irreversible",
  workspaceId: WORKSPACE.id,
  name: "Delete staging record",
  allowedDomains: [],
  writableDomains: ["staging.example.com"],
  testDataAttested: true,
  irreversibleActionScopes: [SCOPE],
  startUrl: "https://staging.example.com/test-records/one",
  instructions: "Delete test record one and verify it is gone",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 1,
  notifyOnRecovery: true,
  nextRunAt: NOW,
  createdBy: "usr_owner",
  updatedBy: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

describe("CreateRun irreversible authorization", () => {
  it("never grants irreversible uses to a scheduled run", async () => {
    const tests = new FakeBrowserTestRepo();
    const runs = new FakeRunRepo();
    const workspaces = new FakeWorkspaceRepo();
    const subscriptions = new FakeSubscriptionRepo();
    await tests.insert(TEST);
    await tests.setChannels(TEST.id, []);
    await workspaces.insert(WORKSPACE);
    await subscriptions.upsertByWorkspace(SUBSCRIPTION);
    const createRun = new CreateRun(
      tests,
      runs,
      workspaces,
      subscriptions,
      {
        insertRunWithAttempt: async (run, attempt) => {
          await runs.insertWithAttempt(run, attempt);
        },
      },
      { publishById: async () => false },
      {
        llmModel: "gpt-5-mini",
        runnerCapabilitySecret: "scheduled-authorization-secret".padEnd(32, "-"),
      },
      new FixedClock(NOW),
      new FakeIds(),
    );

    const run = await createRun.execute({
      workspaceId: WORKSPACE.id,
      source: "SCHEDULED",
      testId: TEST.id,
      scheduledFor: NOW,
      // Even an erroneous internal caller cannot synthesize a human approval.
      approveIrreversibleActions: true,
    });

    expect(run.snapshot.irreversibleAuthorization).toBeUndefined();
    expect(run.actionAuthorizations).toEqual([]);
  });
});
