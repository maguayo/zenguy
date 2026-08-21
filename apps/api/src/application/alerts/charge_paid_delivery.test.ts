import { defaultAlertSettings } from "../../domain/alerts/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { RecordingEmailSender } from "../../test/fakes/email";
import { FakeIds } from "../../test/fakes/ids";
import { ChargePaidDelivery } from "./charge_paid_delivery";

const NOW = Date.parse("2026-08-22T10:00:00Z");
const WORKSPACE: Workspace = {
  id: "ws_1",
  name: "Acme",
  slug: "acme",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};
const OWNER: User = {
  id: "usr_owner",
  name: "Owner",
  email: "owner@acme.test",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};
const SPAIN_SMS = {
  workspaceId: "ws_1",
  deliveryId: "del_1",
  channelType: "SMS" as const,
  config: { phoneNumber: "+34600123456", consent: true },
};

function fixture(options: { enabled?: boolean; balance?: number; limit?: number } = {}) {
  const alerts = new FakeAlertRepo();
  alerts.settings.set("ws_1", {
    ...defaultAlertSettings("ws_1", 1),
    paidChannelsEnabled: options.enabled ?? true,
    dailyPaidAlertLimit: options.limit ?? 20,
  });
  alerts.setBalance("ws_1", options.balance ?? 100);
  const email = new RecordingEmailSender();
  const clock = new FixedClock(NOW);
  const charger = new ChargePaidDelivery(
    alerts,
    { findById: async () => WORKSPACE },
    { findById: async () => OWNER },
    email,
    "https://app.zenguy.test/",
    clock,
    new FakeIds(),
  );
  return { alerts, email, clock, charger };
}

describe("ChargePaidDelivery", () => {
  it("debits the destination price once per delivery and replays on retry", async () => {
    const { alerts, charger } = fixture({ balance: 100 });

    const first = await charger.charge(SPAIN_SMS);
    expect(first).toEqual({
      ok: true,
      costCents: 18,
      destination: { iso: "ES", name: "Spain", region: "EUROPE" },
      replayed: false,
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
    expect(alerts.entries).toHaveLength(1);
    expect(alerts.entries[0]).toMatchObject({
      kind: "CHARGE",
      amountCents: -18,
      deliveryId: "del_1",
      description: "SMS to Spain",
      idempotencyKey: "charge:del_1",
    });

    const replay = await charger.charge(SPAIN_SMS);
    expect(replay).toMatchObject({ ok: true, costCents: 18, replayed: true });
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);
    expect(alerts.entries).toHaveLength(1);
  });

  it("prices calls, WhatsApp, and unknown destinations", async () => {
    const { charger } = fixture({ balance: 1_000 });
    await expect(
      charger.charge({
        ...SPAIN_SMS,
        deliveryId: "del_call",
        channelType: "CALL",
        config: { phoneNumber: "+31612345678" },
      }),
    ).resolves.toMatchObject({ ok: true, costCents: 56 });
    await expect(
      charger.charge({
        ...SPAIN_SMS,
        deliveryId: "del_wa",
        channelType: "WHATSAPP",
        config: { phoneNumber: "+12025550123" },
      }),
    ).resolves.toMatchObject({ ok: true, costCents: 5 });
    await expect(
      charger.charge({
        ...SPAIN_SMS,
        deliveryId: "del_row",
        channelType: "SMS",
        config: { phoneNumber: "+5215512345678", consent: true },
      }),
    ).resolves.toMatchObject({
      ok: true,
      costCents: 40,
      destination: { iso: null, name: "Mexico", region: "ROW" },
    });
    await expect(
      charger.charge({ ...SPAIN_SMS, channelType: "EMAIL", config: {} }),
    ).rejects.toThrow();
  });

  it("skips when SMS & calls are off, without touching the balance", async () => {
    const { alerts, charger } = fixture({ enabled: false, balance: 100 });
    await expect(charger.charge(SPAIN_SMS)).resolves.toEqual({
      ok: false,
      reason: "PAID_OFF",
      message: "Skipped: SMS & calls are turned off for this workspace",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(100);
    expect(alerts.entries).toHaveLength(0);
  });

  it("enforces the rolling 24-hour limit of paid alerts", async () => {
    const { alerts, charger, clock } = fixture({ balance: 1_000, limit: 2 });
    await charger.charge({ ...SPAIN_SMS, deliveryId: "del_a" });
    clock.advance(60_000);
    await charger.charge({ ...SPAIN_SMS, deliveryId: "del_b" });
    clock.advance(60_000);
    await expect(
      charger.charge({ ...SPAIN_SMS, deliveryId: "del_c" }),
    ).resolves.toEqual({
      ok: false,
      reason: "DAILY_LIMIT",
      message: "Skipped: daily limit of 2 paid alerts reached",
    });
    expect(alerts.entries).toHaveLength(2);

    clock.advance(24 * 60 * 60 * 1_000);
    await expect(
      charger.charge({ ...SPAIN_SMS, deliveryId: "del_d" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("skips on insufficient credit and emails the owner once until the next top-up", async () => {
    const { alerts, charger, email } = fixture({ balance: 10 });

    const first = await charger.charge(SPAIN_SMS);
    expect(first).toEqual({
      ok: false,
      reason: "NO_CREDIT",
      message: "Skipped: not enough alert credit (€0.18 needed, €0.10 left)",
    });
    expect(await alerts.getBalanceCents("ws_1")).toBe(10);
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({
      to: ["owner@acme.test"],
      subject: "Zenguy: Alert credit is used up",
    });
    expect(email.messages[0]?.text).toContain(
      "https://app.zenguy.test/w/ws_1/alerts/sms-calls",
    );
    expect(alerts.settings.get("ws_1")?.lowBalanceNotifiedAt).toBe(NOW);

    await charger.charge({ ...SPAIN_SMS, deliveryId: "del_2" });
    expect(email.messages).toHaveLength(1);

    await alerts.updateSettings("ws_1", { lowBalanceNotifiedAt: null }, NOW);
    await charger.charge({ ...SPAIN_SMS, deliveryId: "del_3" });
    expect(email.messages).toHaveLength(2);
  });

  it("warns once when the balance drops below the low threshold", async () => {
    const { charger, email } = fixture({ balance: 210 });
    await charger.charge(SPAIN_SMS);
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]?.subject).toBe(
      "Zenguy: Alert credit is running low",
    );
    expect(email.messages[0]?.text).toContain("€1.92");
    await charger.charge({ ...SPAIN_SMS, deliveryId: "del_2" });
    expect(email.messages).toHaveLength(1);
  });

  it("keeps charging when the notice email fails", async () => {
    const { alerts, clock } = fixture({ balance: 210 });
    const charger = new ChargePaidDelivery(
      alerts,
      { findById: async () => WORKSPACE },
      { findById: async () => OWNER },
      new RecordingEmailSender(new Error("smtp down")),
      "https://app.zenguy.test",
      clock,
      new FakeIds(),
    );
    await expect(charger.charge(SPAIN_SMS)).resolves.toMatchObject({ ok: true });
    expect(await alerts.getBalanceCents("ws_1")).toBe(192);
  });

  it("refunds a charged delivery exactly once", async () => {
    const { alerts, charger } = fixture({ balance: 100 });
    await charger.charge(SPAIN_SMS);
    expect(await alerts.getBalanceCents("ws_1")).toBe(82);

    await expect(
      charger.refund({
        workspaceId: "ws_1",
        deliveryId: "del_1",
        reason: "provider delivery failed",
      }),
    ).resolves.toBe(true);
    expect(await alerts.getBalanceCents("ws_1")).toBe(100);
    expect(alerts.entries.at(-1)).toMatchObject({
      kind: "REFUND",
      amountCents: 18,
      deliveryId: "del_1",
      description: "Refund: provider delivery failed",
    });

    await expect(
      charger.refund({
        workspaceId: "ws_1",
        deliveryId: "del_1",
        reason: "again",
      }),
    ).resolves.toBe(false);
    await expect(
      charger.refund({
        workspaceId: "ws_1",
        deliveryId: "del_unknown",
        reason: "nothing charged",
      }),
    ).resolves.toBe(false);
    expect(await alerts.getBalanceCents("ws_1")).toBe(100);
  });
});
