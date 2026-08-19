import { WriteAudit } from "../audit/write_audit";
import type { PeriodOverageReporter } from "./handle_paddle_webhook";
import { HandlePaddleWebhook } from "./handle_paddle_webhook";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex } from "../../shared/crypto";
import { FakeIds } from "../../test/fakes/ids";
import { FakeKv } from "../../test/fakes/kv";
import {
  FakeAuditRepo,
  FakePendingOveragePeriodRepo,
  FakeSubscriptionRepo,
} from "../../test/fakes/repos";
import {
  PADDLE_SUBSCRIPTION_CREATED,
  PADDLE_SUBSCRIPTION_UPDATED,
} from "../../test/fixtures/paddle";

const NOW = Date.parse("2026-09-01T00:05:00Z");
const SIGNING_SECRET = "pdl_webhook_test_secret";

class RecordingOverageReporter implements PeriodOverageReporter {
  readonly calls: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
    providerSubscriptionId: string;
  }[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async execute(input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
    providerSubscriptionId: string;
  }): Promise<void> {
    this.calls.push({ ...input });
    if (this.failure !== null) throw this.failure;
  }
}

async function signature(rawBody: string, timestamp = NOW / 1_000) {
  const h1 = await hmacSha256Hex(
    SIGNING_SECRET,
    `${timestamp}:${rawBody}`,
  );
  return `ts=${timestamp};h1=${h1}`;
}

function setup(overageReporter = new RecordingOverageReporter()) {
  const clock = new FixedClock(NOW);
  const subscriptions = new FakeSubscriptionRepo();
  const pendingOveragePeriods = new FakePendingOveragePeriodRepo();
  const audits = new FakeAuditRepo();
  const handler = new HandlePaddleWebhook({
    webhookSecret: SIGNING_SECRET,
    kv: new FakeKv(clock),
    subscriptions,
    pendingOveragePeriods,
    overageReporter,
    audit: new WriteAudit({ audits, clock, ids: new FakeIds() }),
    clock,
    ids: new FakeIds(),
  });
  return {
    handler,
    subscriptions,
    pendingOveragePeriods,
    audits,
    overageReporter,
  };
}

async function deliver(
  handler: HandlePaddleWebhook,
  payload: unknown,
) {
  const rawBody = JSON.stringify(payload);
  return handler.execute({
    rawBody,
    signatureHeader: await signature(rawBody),
    ip: "192.0.2.10",
  });
}

describe("HandlePaddleWebhook", () => {
  it("accepts a valid signature and maps subscription fields", async () => {
    const { handler, subscriptions, audits } = setup();

    await expect(deliver(handler, PADDLE_SUBSCRIPTION_CREATED)).resolves.toEqual(
      { handled: "processed" },
    );

    const stored = await subscriptions.findByWorkspace("ws_primary");
    expect(stored).toMatchObject({
      workspaceId: "ws_primary",
      providerCustomerId: "ctm_provider_123",
      providerSubscriptionId: "sub_provider_123",
      status: "ACTIVE",
      periodStart: Date.parse("2026-08-01T00:00:00Z"),
      periodEnd: Date.parse("2026-09-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      updatePaymentUrl: null,
      cancelUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
      lastProviderEventAt: Date.parse("2026-08-01T00:00:01Z"),
    });
    expect([...audits.entries.values()][0]).toMatchObject({
      workspaceId: "ws_primary",
      actorUserId: null,
      action: "billing.subscription_updated",
      resourceType: "subscription",
      resourceId: stored?.id,
      ip: "192.0.2.10",
    });
    expect(
      JSON.parse([...audits.entries.values()][0]?.metadataJson ?? "null"),
    ).toEqual({ status: "ACTIVE" });
  });

  it("processes each event id once", async () => {
    const { handler, subscriptions, audits } = setup();

    await expect(deliver(handler, PADDLE_SUBSCRIPTION_CREATED)).resolves.toEqual(
      { handled: "processed" },
    );
    await expect(deliver(handler, PADDLE_SUBSCRIPTION_CREATED)).resolves.toEqual(
      { handled: "duplicate" },
    );

    expect(subscriptions.subscriptions.size).toBe(1);
    expect(audits.entries.size).toBe(1);
  });

  it("maps period rollover, past-due status, and scheduled cancel", async () => {
    const {
      handler,
      subscriptions,
      pendingOveragePeriods,
      overageReporter,
    } = setup();
    await deliver(handler, PADDLE_SUBSCRIPTION_CREATED);

    await expect(deliver(handler, PADDLE_SUBSCRIPTION_UPDATED)).resolves.toEqual(
      { handled: "processed" },
    );

    expect(overageReporter.calls).toEqual([
      {
        workspaceId: "ws_primary",
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        providerSubscriptionId: "sub_provider_123",
      },
    ]);
    await expect(pendingOveragePeriods.list(10)).resolves.toEqual([
      {
        workspaceId: "ws_primary",
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        createdAt: NOW,
        providerSubscriptionId: "sub_provider_123",
        nextAttemptAt: Date.parse("2026-09-01T01:00:00Z"),
        attemptCount: 0,
      },
    ]);
    await expect(subscriptions.findByWorkspace("ws_primary")).resolves.toMatchObject(
      {
        status: "PAST_DUE",
        periodStart: Date.parse("2026-09-01T00:00:00Z"),
        periodEnd: Date.parse("2026-10-01T00:00:00Z"),
        cancelAtPeriodEnd: true,
        updatePaymentUrl: null,
        cancelUrl: null,
        lastProviderEventAt: Date.parse("2026-09-01T00:00:01Z"),
      },
    );
  });

  it("maps canceled events even when their payload carries another status", async () => {
    const { handler, subscriptions } = setup();
    await deliver(handler, PADDLE_SUBSCRIPTION_CREATED);
    const canceled = {
      ...PADDLE_SUBSCRIPTION_UPDATED,
      event_id: "evt_subscription_canceled",
      event_type: "subscription.canceled",
      data: { ...PADDLE_SUBSCRIPTION_UPDATED.data, status: "active" },
    };

    await deliver(handler, canceled);

    await expect(subscriptions.findByWorkspace("ws_primary")).resolves.toMatchObject(
      { status: "CANCELED" },
    );
  });

  it("rejects tampered and stale deliveries", async () => {
    const { handler } = setup();
    const rawBody = JSON.stringify(PADDLE_SUBSCRIPTION_CREATED);
    const validHeader = await signature(rawBody);

    await expect(
      handler.execute({
        rawBody: `${rawBody} `,
        signatureHeader: validHeader,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const oldTimestamp = NOW / 1_000 - 15 * 60 - 1;
    await expect(
      handler.execute({
        rawBody,
        signatureHeader: await signature(rawBody, oldTimestamp),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ignores unknown signed event types idempotently", async () => {
    const { handler } = setup();
    const unknown = {
      event_id: "evt_unknown",
      event_type: "transaction.completed",
      occurred_at: "2026-09-01T00:00:01Z",
      data: { id: "txn_123" },
    };

    await expect(deliver(handler, unknown)).resolves.toEqual({
      handled: "ignored",
    });
    await expect(deliver(handler, unknown)).resolves.toEqual({
      handled: "duplicate",
    });
  });

  it("keeps rollover processing best-effort", async () => {
    const reporter = new RecordingOverageReporter(
      new Error("billing unavailable with PII alice@example.com"),
    );
    const { handler, subscriptions, pendingOveragePeriods } = setup(reporter);
    await deliver(handler, PADDLE_SUBSCRIPTION_CREATED);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(deliver(handler, PADDLE_SUBSCRIPTION_UPDATED)).resolves.toEqual(
      { handled: "processed" },
    );

    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain(
      '"event":"overage_rollover_failed"',
    );
    expect(String(log.mock.calls[0]?.[0])).not.toContain("alice@example.com");
    await expect(subscriptions.findByWorkspace("ws_primary")).resolves.toMatchObject(
      { status: "PAST_DUE" },
    );
    await expect(pendingOveragePeriods.list(10)).resolves.toEqual([
      {
        workspaceId: "ws_primary",
        periodStart: Date.parse("2026-08-01T00:00:00Z"),
        periodEnd: Date.parse("2026-09-01T00:00:00Z"),
        createdAt: NOW,
        providerSubscriptionId: "sub_provider_123",
        nextAttemptAt: Date.parse("2026-09-01T01:00:00Z"),
        attemptCount: 0,
      },
    ]);
    log.mockRestore();
  });

  it("ignores an out-of-order provider event without rolling billing backward", async () => {
    const { handler, subscriptions, pendingOveragePeriods, overageReporter } =
      setup();
    await deliver(handler, PADDLE_SUBSCRIPTION_CREATED);
    await deliver(handler, PADDLE_SUBSCRIPTION_UPDATED);
    const stale = {
      ...PADDLE_SUBSCRIPTION_CREATED,
      event_id: "evt_subscription_stale",
      event_type: "subscription.updated",
      occurred_at: "2026-08-15T00:00:00Z",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(deliver(handler, stale)).resolves.toEqual({
      handled: "ignored",
    });

    await expect(subscriptions.findByWorkspace("ws_primary")).resolves.toMatchObject(
      {
        periodStart: Date.parse("2026-09-01T00:00:00Z"),
        periodEnd: Date.parse("2026-10-01T00:00:00Z"),
        lastProviderEventAt: Date.parse("2026-09-01T00:00:01Z"),
      },
    );
    expect(overageReporter.calls).toHaveLength(1);
    await expect(pendingOveragePeriods.list(10)).resolves.toHaveLength(1);
    expect(String(log.mock.calls[0]?.[0])).toContain(
      '"event":"paddle_subscription_event_stale"',
    );
  });
});
