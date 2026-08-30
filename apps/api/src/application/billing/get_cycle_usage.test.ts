import type { Subscription } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import {
  FakeSubscriptionRepo,
  FakeUsageEventRepo,
} from "../../test/fakes/repos";
import { GetCycleUsage } from "./get_cycle_usage";

const PERIOD_START = Date.parse("2026-08-01T00:00:00Z");
const PERIOD_END = Date.parse("2026-09-01T00:00:00Z");

const SUBSCRIPTION: Subscription = {
  id: "sub_local",
  workspaceId: "ws_primary",
  provider: "paddle",
  providerCustomerId: "ctm_123",
  providerSubscriptionId: "sub_123",
  status: "ACTIVE",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: PERIOD_START,
  updatedAt: PERIOD_START,
};

async function usageFor(count: number) {
  const subscriptions = new FakeSubscriptionRepo();
  await subscriptions.upsertByWorkspace(SUBSCRIPTION);
  const usageEvents = new FakeUsageEventRepo();
  if (count > 0) {
    await usageEvents.insertIfAbsent({
      id: "ue_total",
      workspaceId: "ws_primary",
      testRunId: "run_total",
      type: "BROWSER_RUN",
      quantity: count,
      billable: true,
      idempotencyKey: "run:run_total",
      occurredAt: PERIOD_START,
      reversedAt: null,
      createdAt: PERIOD_START,
    });
  }
  return new GetCycleUsage(
    subscriptions,
    usageEvents,
    new FixedClock(Date.parse("2026-08-20T12:00:00Z")),
  ).execute({ workspaceId: "ws_primary" });
}

describe("GetCycleUsage", () => {
  it.each([
    [0, 300, 0, 0, 3900],
    [299, 1, 0, 0, 3900],
    [300, 0, 0, 0, 3900],
    [301, 0, 1, 20, 3920],
    [350, 0, 50, 1000, 4900],
  ])(
    "calculates %i billable runs",
    async (
      billableRuns,
      remainingRuns,
      overageRuns,
      overageAmountCents,
      projectedTotalCents,
    ) => {
      await expect(usageFor(billableRuns)).resolves.toEqual({
        currency: "EUR",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        billableRuns,
        includedRuns: 300,
        remainingRuns,
        overageRuns,
        overageAmountCents,
        projectedTotalCents,
      });
    },
  );

  it("does not project a paid total for a grant-activated workspace", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      source: "grant",
      providerCustomerId: null,
      providerSubscriptionId: null,
    });
    const usageEvents = new FakeUsageEventRepo();
    await usageEvents.insertIfAbsent({
      id: "ue_total",
      workspaceId: "ws_primary",
      testRunId: "run_total",
      type: "BROWSER_RUN",
      quantity: 350,
      billable: true,
      idempotencyKey: "run:run_total",
      occurredAt: PERIOD_START,
      reversedAt: null,
      createdAt: PERIOD_START,
    });
    const getUsage = new GetCycleUsage(
      subscriptions,
      usageEvents,
      new FixedClock(Date.parse("2026-08-20T12:00:00Z")),
    );

    await expect(getUsage.execute({ workspaceId: "ws_primary" })).resolves.toEqual({
      currency: "EUR",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      billableRuns: 350,
      includedRuns: 300,
      remainingRuns: 0,
      overageRuns: 0,
      overageAmountCents: 0,
      projectedTotalCents: 0,
    });
  });

  it("uses a monthly cycle and never bills grandfathered internal access", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      provider: "internal",
      source: "free",
      providerCustomerId: null,
      providerSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
    });
    const usageEvents = new FakeUsageEventRepo();
    await usageEvents.insertIfAbsent({
      id: "ue_free_launch",
      workspaceId: "ws_primary",
      testRunId: "run_free_launch",
      type: "BROWSER_RUN",
      quantity: 350,
      billable: true,
      idempotencyKey: "run:run_free_launch",
      occurredAt: Date.parse("2026-08-20T12:00:00Z"),
      reversedAt: null,
      createdAt: Date.parse("2026-08-20T12:00:00Z"),
    });
    const getUsage = new GetCycleUsage(
      subscriptions,
      usageEvents,
      new FixedClock(Date.parse("2026-08-20T12:00:00Z")),
    );

    await expect(getUsage.execute({ workspaceId: "ws_primary" })).resolves.toEqual({
      currency: "EUR",
      periodStart: Date.parse("2026-08-01T00:00:00Z"),
      periodEnd: Date.parse("2026-09-01T00:00:00Z"),
      billableRuns: 350,
      includedRuns: 300,
      remainingRuns: 0,
      overageRuns: 0,
      overageAmountCents: 0,
      projectedTotalCents: 0,
    });
  });

  it("falls back to the current UTC calendar month without usable periods", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      status: "NONE",
      periodStart: null,
      periodEnd: null,
    });
    const usageEvents = new FakeUsageEventRepo();
    await usageEvents.insertIfAbsent({
      id: "ue_august",
      workspaceId: "ws_primary",
      testRunId: "run_august",
      type: "BROWSER_RUN",
      quantity: 4,
      billable: true,
      idempotencyKey: "run:run_august",
      occurredAt: Date.parse("2026-08-15T12:00:00Z"),
      reversedAt: null,
      createdAt: Date.parse("2026-08-15T12:00:00Z"),
    });
    const getUsage = new GetCycleUsage(
      subscriptions,
      usageEvents,
      new FixedClock(Date.parse("2026-08-31T23:59:59Z")),
    );

    await expect(getUsage.execute({ workspaceId: "ws_primary" })).resolves.toMatchObject(
      {
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        billableRuns: 4,
      },
    );
  });

  it("returns the currency pinned to the subscription", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      currencyCode: "USD",
    });
    const usage = new GetCycleUsage(
      subscriptions,
      new FakeUsageEventRepo(),
      new FixedClock(PERIOD_START),
    );

    await expect(usage.execute({ workspaceId: "ws_primary" })).resolves
      .toMatchObject({ currency: "USD" });
  });
});
