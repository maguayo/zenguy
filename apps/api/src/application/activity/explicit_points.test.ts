import type { Subscription } from "../../domain/billing/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import { serializeTestsFile } from "../../domain/browser_tests/transfer";
import { FixedClock } from "../../shared/clock";
import type { PaddleConfig } from "../../shared/config";
import type { RateLimiter } from "../../shared/ratelimit";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { testUser } from "../../test/fakes/auth";
import { FakeBrowserTestRepo } from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import { FakePaddleCheckoutIntentRepo } from "../../test/fakes/paddle_checkout_intents";
import { FakeChannelRepo, FakeSubscriptionRepo } from "../../test/fakes/repos";
import { shouldRecordApiKeyUse } from "../../http/routes/public_api";
import { IssuePaddleCheckoutIntent } from "../billing/paddle_checkout_intent";
import { ImportBrowserTests } from "../browser_tests/import_tests";
import type { BrowserTestOutput } from "../browser_tests/types";
import { ValidateDraft } from "../browser_tests/validate_draft";
import type { CheckOutcome } from "../uptime/execute_check";
import { TestRequest } from "../uptime/test_request";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const WORKSPACE_ID = "ws_1";
const OWNER = testUser({ id: "usr_owner", emailVerifiedAt: 1 });

const allowAll: RateLimiter = {
  hit: async () => ({ allowed: true, retryAfterSeconds: 1 }),
};

function activeSubscription(): Subscription {
  return {
    id: "sub_1",
    workspaceId: WORKSPACE_ID,
    provider: "paddle",
    providerCustomerId: "ctm_1",
    providerSubscriptionId: "sub_provider_1",
    status: "ACTIVE",
    periodStart: 1,
    periodEnd: 9_999_999_999_999,
    cancelAtPeriodEnd: false,
    updatePaymentUrl: null,
    cancelUrl: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function subscribedWorkspace(): Promise<FakeSubscriptionRepo> {
  const subscriptions = new FakeSubscriptionRepo();
  await subscriptions.upsertByWorkspace(activeSubscription());
  return subscriptions;
}

const DRAFT = {
  name: "Checkout",
  startUrl: "https://example.com/checkout",
  instructions: "Add an item to the cart and pay",
  device: "DESKTOP" as const,
  intervalHours: 24,
  maxRetries: 0,
  notifyOnRecovery: false,
  channelIds: [] as string[],
};

describe("ValidateDraft activity", () => {
  it("records browser_test.validated after creating the validation run", async () => {
    const track = new FakeTrackEvent();
    const createRun = { execute: vi.fn(async () => ({ id: "run_1" }) as never) };
    const validate = new ValidateDraft(
      createRun,
      await subscribedWorkspace(),
      allowAll,
      track,
    );

    await validate.execute({
      workspaceId: WORKSPACE_ID,
      actor: OWNER,
      actorRole: "OWNER",
      config: DRAFT,
    });

    expect(createRun.execute).toHaveBeenCalledOnce();
    expect(track.calls).toEqual([
      {
        type: "browser_test.validated",
        userId: OWNER.id,
        workspaceId: WORKSPACE_ID,
        source: "server",
        properties: { runId: "run_1" },
      },
    ]);
  });

  it("records nothing when the actor may not run tests", async () => {
    const track = new FakeTrackEvent();
    const validate = new ValidateDraft(
      { execute: vi.fn() },
      await subscribedWorkspace(),
      allowAll,
      track,
    );

    await expect(
      validate.execute({
        workspaceId: WORKSPACE_ID,
        actor: OWNER,
        actorRole: "MEMBER",
        config: DRAFT,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(track.calls).toEqual([]);
  });
});

describe("ImportBrowserTests activity", () => {
  function output(id: string): BrowserTestOutput {
    return {
      id,
      ...DRAFT,
      allowedDomains: [],
      writableDomains: [],
      testDataAttested: false,
      irreversibleActionScopes: [],
      nextRunAt: NOW,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      recentRuns: [],
      lastRun: null,
      openIncidentId: null,
    };
  }

  function existingTest(id: string): BrowserTest {
    return {
      id,
      workspaceId: WORKSPACE_ID,
      name: DRAFT.name,
      startUrl: DRAFT.startUrl,
      instructions: DRAFT.instructions,
      device: DRAFT.device,
      intervalHours: DRAFT.intervalHours,
      maxRetries: DRAFT.maxRetries,
      notifyOnRecovery: DRAFT.notifyOnRecovery,
      nextRunAt: NOW,
      createdBy: OWNER.id,
      updatedBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
  }

  it("records browser_test.imported with the created and updated counts", async () => {
    const track = new FakeTrackEvent();
    const tests = new FakeBrowserTestRepo();
    await tests.insert(existingTest("bt_existing"));
    const importTests = new ImportBrowserTests(
      { execute: async () => output("bt_new") },
      { execute: async ({ testId }) => output(testId) },
      tests,
      new FakeChannelRepo(),
      await subscribedWorkspace(),
      allowAll,
      track,
    );

    const summary = await importTests.execute({
      workspaceId: WORKSPACE_ID,
      actor: OWNER,
      actorRole: "OWNER",
      fileText: serializeTestsFile(
        [
          { ...DRAFT, name: "Fresh" },
          { ...DRAFT, id: "bt_existing", name: "Renamed" },
          { ...DRAFT, id: "bt_foreign", name: "Unknown id creates" },
        ],
        "json",
      ),
    });

    expect(summary).toMatchObject({ created: 2, updated: 1 });
    expect(track.calls).toEqual([
      {
        type: "browser_test.imported",
        userId: OWNER.id,
        workspaceId: WORKSPACE_ID,
        source: "server",
        properties: { created: 2, updated: 1 },
      },
    ]);
  });

  it("records nothing when the file is rejected", async () => {
    const track = new FakeTrackEvent();
    const importTests = new ImportBrowserTests(
      { execute: vi.fn() },
      { execute: vi.fn() },
      new FakeBrowserTestRepo(),
      new FakeChannelRepo(),
      await subscribedWorkspace(),
      allowAll,
      track,
    );

    await expect(
      importTests.execute({
        workspaceId: WORKSPACE_ID,
        actor: OWNER,
        actorRole: "OWNER",
        fileText: "not a tests file",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(track.calls).toEqual([]);
  });
});

describe("TestRequest activity", () => {
  const CONFIG = {
    url: "https://example.com/health",
    method: "GET",
    expectedStatus: 200,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    channelIds: [],
  };

  function outcome(status: CheckOutcome["status"]): CheckOutcome {
    return {
      status,
      httpStatus: status === "PASSED" ? 200 : 503,
      responseTimeMs: 12,
      failureReason: null,
      responseExcerpt: null,
      conditions: [],
    };
  }

  it("records uptime_monitor.tested with the outcome status", async () => {
    const track = new FakeTrackEvent();
    const testRequest = new TestRequest(
      { listByIds: async () => [] },
      await subscribedWorkspace(),
      allowAll,
      async () => outcome("FAILED"),
      track,
    );

    const result = await testRequest.execute({
      workspaceId: WORKSPACE_ID,
      actor: OWNER,
      actorRole: "ADMIN",
      config: CONFIG,
    });

    expect(result.passed).toBe(false);
    expect(track.calls).toEqual([
      {
        type: "uptime_monitor.tested",
        userId: OWNER.id,
        workspaceId: WORKSPACE_ID,
        source: "server",
        properties: { status: "FAILED" },
      },
    ]);
  });

  it("records nothing when the request is rejected before executing", async () => {
    const track = new FakeTrackEvent();
    const executeCheck = vi.fn(async () => outcome("PASSED"));
    const testRequest = new TestRequest(
      { listByIds: async () => [] },
      await subscribedWorkspace(),
      allowAll,
      executeCheck,
      track,
    );

    await expect(
      testRequest.execute({
        workspaceId: WORKSPACE_ID,
        actor: OWNER,
        actorRole: "ADMIN",
        config: { ...CONFIG, method: "POST" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(executeCheck).not.toHaveBeenCalled();
    expect(track.calls).toEqual([]);
  });
});

describe("IssuePaddleCheckoutIntent activity", () => {
  const PADDLE: PaddleConfig = {
    apiKey: "api",
    webhookSecret: "webhook-secret",
    clientToken: "client",
    environment: "sandbox",
    productId: "pro_monthly",
    priceId: "pri_monthly",
    overagePriceId: "pri_overage",
    alertCreditProductId: "pro_alert_credit",
    alertCreditPriceId: "pri_alert_credit",
    apiBase: "https://sandbox-api.paddle.com",
  };

  function useCase(track: FakeTrackEvent): IssuePaddleCheckoutIntent {
    return new IssuePaddleCheckoutIntent(
      new FakePaddleCheckoutIntentRepo(),
      PADDLE,
      new FixedClock(NOW),
      new FakeIds(),
      undefined,
      track,
    );
  }

  it("records billing.checkout_started with the checkout kind", async () => {
    const track = new FakeTrackEvent();

    await useCase(track).execute({
      workspaceId: WORKSPACE_ID,
      actor: OWNER,
      actorRole: "OWNER",
      purpose: "subscription",
    });

    expect(track.calls).toEqual([
      {
        type: "billing.checkout_started",
        userId: OWNER.id,
        workspaceId: WORKSPACE_ID,
        source: "server",
        properties: { kind: "subscription" },
      },
    ]);
  });

  it("records nothing when the checkout is refused", async () => {
    const track = new FakeTrackEvent();

    await expect(
      useCase(track).execute({
        workspaceId: WORKSPACE_ID,
        actor: OWNER,
        actorRole: "ADMIN",
        purpose: "subscription",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(track.calls).toEqual([]);
  });
});

describe("shouldRecordApiKeyUse", () => {
  const MINUTE = 60_000;

  it("records the first use of a key", () => {
    expect(shouldRecordApiKeyUse(null, NOW)).toBe(true);
  });

  it("throttles uses within fifteen minutes of the previous one", () => {
    expect(shouldRecordApiKeyUse(NOW - 14 * MINUTE, NOW)).toBe(false);
  });

  it("records again once fifteen minutes have passed", () => {
    expect(shouldRecordApiKeyUse(NOW - 16 * MINUTE, NOW)).toBe(true);
  });
});
