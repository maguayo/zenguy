import type { Subscription } from "../../domain/billing/types";
import { FixedClock } from "../../shared/clock";
import { RecordingPaddleClient } from "../../test/fakes/billing";
import {
  FakeSubscriptionRepo,
  FakeUsageEventRepo,
} from "../../test/fakes/repos";
import { GetBilling } from "./get_billing";
import { GetCycleUsage } from "./get_cycle_usage";
import { GetInvoiceUrl } from "./get_invoice_url";

const PERIOD_START = Date.parse("2026-08-01T00:00:00Z");
const PERIOD_END = Date.parse("2026-09-01T00:00:00Z");
const SUBSCRIPTION: Subscription = {
  id: "sub_local",
  workspaceId: "ws_primary",
  provider: "paddle",
  providerCustomerId: "ctm_123",
  providerSubscriptionId: "sub_provider",
  status: "ACTIVE",
  periodStart: PERIOD_START,
  periodEnd: PERIOD_END,
  cancelAtPeriodEnd: true,
  updatePaymentUrl: null,
  cancelUrl: null,
  createdAt: PERIOD_START,
  updatedAt: PERIOD_START,
};

async function setup(paddle = new RecordingPaddleClient()) {
  const subscriptions = new FakeSubscriptionRepo();
  await subscriptions.upsertByWorkspace(SUBSCRIPTION);
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
  paddle.transactions = [
    {
      id: "txn_123",
      billedAt: "2026-08-01T00:00:00Z",
      status: "paid",
      totalCents: 3900,
      currency: "EUR",
      invoiceNumber: "INV-123",
    },
  ];
  paddle.managementUrls = {
    updatePaymentMethodUrl: "https://paddle.test/update",
    cancelUrl: "https://paddle.test/cancel",
  };
  const usage = new GetCycleUsage(
    subscriptions,
    usageEvents,
    new FixedClock(PERIOD_START),
  );
  return {
    subscriptions,
    paddle,
    getBilling: new GetBilling(subscriptions, usage, paddle),
    getInvoiceUrl: new GetInvoiceUrl(subscriptions, paddle),
  };
}

describe("GetBilling", () => {
  it("returns plan, usage, invoices, and owner management URLs", async () => {
    const { getBilling, paddle } = await setup();

    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "OWNER" }),
    ).resolves.toEqual({
      plan: {
        pricePerMonthCents: 3900,
        currency: "EUR",
        includedRuns: 300,
        overagePerRunCents: 20,
      },
      subscription: {
        status: "ACTIVE",
        source: "paddle",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        cancelAtPeriodEnd: true,
        updatePaymentMethodUrl: "https://paddle.test/update",
        cancelUrl: "https://paddle.test/cancel",
      },
      usage: {
        currency: "EUR",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        billableRuns: 350,
        includedRuns: 300,
        remainingRuns: 0,
        overageRuns: 50,
        overageAmountCents: 1000,
        projectedTotalCents: 4900,
      },
      invoices: paddle.transactions,
    });
    expect(paddle.transactionLists).toEqual([
      { subscriptionId: "sub_provider", limit: 12 },
    ]);
    expect(paddle.managementUrlRequests).toEqual(["sub_provider"]);
  });

  it("hides management URLs from admins and rejects members", async () => {
    const { getBilling, paddle } = await setup();

    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "ADMIN" }),
    ).resolves.toMatchObject({
      subscription: {
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    });
    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(paddle.managementUrlRequests).toEqual([]);
  });

  it("returns an empty invoice list and sanitized log on Paddle failure", async () => {
    const { getBilling } = await setup(
      new RecordingPaddleClient(
        new Error("Paddle PII alice@example.com must not escape"),
      ),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "ADMIN" }),
    ).resolves.toMatchObject({ invoices: [] });

    expect(log).toHaveBeenCalledOnce();
    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain('"event":"billing_invoice_list_failed"');
    expect(output).not.toContain("alice@example.com");
    log.mockRestore();
  });

  it("keeps billing usable and logs safely when management URLs fail", async () => {
    const paddle = new RecordingPaddleClient();
    paddle.managementUrlsFailure = new Error(
      "Paddle PII alice@example.com must not escape",
    );
    const { getBilling } = await setup(paddle);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "OWNER" }),
    ).resolves.toMatchObject({
      subscription: {
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
      invoices: paddle.transactions,
    });

    expect(paddle.managementUrlRequests).toEqual(["sub_provider"]);
    expect(log).toHaveBeenCalledOnce();
    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain('"event":"billing_management_urls_failed"');
    expect(output).not.toContain("alice@example.com");
    log.mockRestore();
  });

  it("returns a NONE subscription with calendar usage before checkout", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const usageEvents = new FakeUsageEventRepo();
    const paddle = new RecordingPaddleClient();
    const clock = new FixedClock(Date.parse("2026-08-20T12:00:00Z"));
    const getBilling = new GetBilling(
      subscriptions,
      new GetCycleUsage(subscriptions, usageEvents, clock),
      paddle,
    );

    await expect(
      getBilling.execute({ workspaceId: "ws_new", role: "OWNER" }),
    ).resolves.toMatchObject({
      subscription: {
        status: "NONE",
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
      usage: {
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        billableRuns: 0,
      },
      invoices: [],
    });
    expect(paddle.transactionLists).toEqual([]);
    expect(paddle.managementUrlRequests).toEqual([]);
  });

  it("uses regional currency before checkout and stored currency afterwards", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    const usageEvents = new FakeUsageEventRepo();
    const paddle = new RecordingPaddleClient();
    const getBilling = new GetBilling(
      subscriptions,
      new GetCycleUsage(subscriptions, usageEvents, new FixedClock(PERIOD_START)),
      paddle,
    );

    await expect(getBilling.execute({
      workspaceId: "ws_primary",
      role: "OWNER",
      regionalCurrency: "USD",
    })).resolves.toMatchObject({
      plan: { currency: "USD" },
      usage: { currency: "USD" },
    });

    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      currencyCode: "EUR",
    });
    await expect(getBilling.execute({
      workspaceId: "ws_primary",
      role: "OWNER",
      regionalCurrency: "USD",
    })).resolves.toMatchObject({
      plan: { currency: "EUR" },
      usage: { currency: "EUR" },
    });
  });

  it("returns free launch access without contacting Paddle", async () => {
    const subscriptions = new FakeSubscriptionRepo();
    await subscriptions.upsertByWorkspace({
      ...SUBSCRIPTION,
      provider: "internal",
      source: "free",
      providerCustomerId: null,
      providerSubscriptionId: null,
      periodStart: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    });
    const usageEvents = new FakeUsageEventRepo();
    const paddle = new RecordingPaddleClient();
    const clock = new FixedClock(Date.parse("2026-08-20T12:00:00Z"));
    const getBilling = new GetBilling(
      subscriptions,
      new GetCycleUsage(subscriptions, usageEvents, clock),
      paddle,
    );

    await expect(
      getBilling.execute({ workspaceId: "ws_primary", role: "OWNER" }),
    ).resolves.toMatchObject({
      plan: {
        pricePerMonthCents: 0,
        overagePerRunCents: 0,
      },
      subscription: {
        source: "free",
        status: "ACTIVE",
        periodStart: null,
        periodEnd: null,
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
      usage: {
        projectedTotalCents: 0,
      },
      invoices: [],
    });
    expect(paddle.transactionLists).toEqual([]);
    expect(paddle.managementUrlRequests).toEqual([]);
  });
});

describe("GetInvoiceUrl", () => {
  it("returns a URL only for a transaction on the workspace subscription", async () => {
    const { getInvoiceUrl, paddle } = await setup();
    paddle.invoiceUrl = "https://paddle.test/invoice.pdf";

    await expect(
      getInvoiceUrl.execute({
        workspaceId: "ws_primary",
        role: "ADMIN",
        transactionId: "txn_123",
      }),
    ).resolves.toEqual({ url: "https://paddle.test/invoice.pdf" });
    expect(paddle.invoiceRequests).toEqual(["txn_123"]);

    await expect(
      getInvoiceUrl.execute({
        workspaceId: "ws_primary",
        role: "OWNER",
        transactionId: "txn_other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(paddle.invoiceRequests).toEqual(["txn_123"]);
  });

  it("rejects members", async () => {
    const { getInvoiceUrl } = await setup();

    await expect(
      getInvoiceUrl.execute({
        workspaceId: "ws_primary",
        role: "MEMBER",
        transactionId: "txn_123",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
