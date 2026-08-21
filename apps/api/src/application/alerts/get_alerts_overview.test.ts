import { defaultAlertSettings } from "../../domain/alerts/types";
import type { ChannelType } from "../../domain/channels/types";
import { FixedClock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeChannelRepo } from "../../test/fakes/repos";
import { GetAlertsOverview } from "./get_alerts_overview";

const KEY = new Uint8Array(32).fill(3);
const NOW = 1_700_000_000_000;

async function insertChannel(
  channels: FakeChannelRepo,
  id: string,
  type: ChannelType,
  config: unknown,
  enabled = true,
): Promise<void> {
  await channels.insert({
    id,
    workspaceId: "ws_1",
    name: id,
    type,
    encryptedConfig: await encryptSecret(JSON.stringify(config), KEY),
    enabled,
    verifiedAt: null,
    lastDeliveryStatus: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("GetAlertsOverview", () => {
  it("reports settings, pause state, credit for billing viewers, and configured destinations", async () => {
    const alerts = new FakeAlertRepo();
    const channels = new FakeChannelRepo();
    alerts.settings.set("ws_1", {
      ...defaultAlertSettings("ws_1", 1),
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 30,
    });
    alerts.setBalance("ws_1", 150);
    await alerts.debit({
      id: "ace_1",
      workspaceId: "ws_1",
      amountCents: 18,
      idempotencyKey: "charge:del_1",
      description: "SMS to Spain",
      deliveryId: "del_1",
      at: NOW - 1_000,
    });
    await insertChannel(channels, "ch_es_1", "SMS", {
      phoneNumber: "+34600123456",
      consent: true,
    });
    await insertChannel(channels, "ch_es_2", "CALL", { phoneNumber: "+34911222333" });
    await insertChannel(channels, "ch_us", "SMS", {
      phoneNumber: "+12025550123",
      consent: true,
    });
    await insertChannel(
      channels,
      "ch_disabled",
      "CALL",
      { phoneNumber: "+4915123456789" },
      false,
    );
    await insertChannel(channels, "ch_mail", "EMAIL", { emails: ["a@b.co"] });
    const overview = new GetAlertsOverview(
      alerts,
      channels,
      KEY,
      true,
      new FixedClock(NOW),
    );

    const owner = await overview.execute({ workspaceId: "ws_1", role: "OWNER" });
    expect(owner.settings).toEqual({
      paidChannelsEnabled: true,
      dailyPaidAlertLimit: 30,
    });
    expect(owner.status).toEqual({
      paidChannelCount: 3,
      paidAlertsPaused: false,
      pauseReason: null,
    });
    expect(owner.credit).toEqual({
      balanceCents: 132,
      currency: "EUR",
      lowBalance: true,
      lowBalanceThresholdCents: 200,
      paidAlertsLast24h: 1,
    });
    expect(owner.topUp).toEqual({
      available: true,
      packCents: 1_000,
      minPacks: 1,
      maxPacks: 10,
    });
    expect(owner.pricing.regions.map((region) => region.key)).toEqual([
      "US_CA",
      "EUROPE",
      "ROW",
    ]);
    expect(owner.destinations).toEqual([
      { iso: "ES", name: "Spain", channels: 2 },
      { iso: "US", name: "United States", channels: 1 },
    ]);

    const member = await overview.execute({ workspaceId: "ws_1", role: "MEMBER" });
    expect(member.credit).toBeNull();
    expect(member.status.paidChannelCount).toBe(3);
  });

  it("explains why paid alerts are paused and creates default settings", async () => {
    const alerts = new FakeAlertRepo();
    const channels = new FakeChannelRepo();
    const overview = new GetAlertsOverview(
      alerts,
      channels,
      KEY,
      false,
      new FixedClock(NOW),
    );

    const off = await overview.execute({ workspaceId: "ws_1", role: "OWNER" });
    expect(off.status).toEqual({
      paidChannelCount: 0,
      paidAlertsPaused: true,
      pauseReason: "PAID_OFF",
    });
    expect(off.topUp.available).toBe(false);
    expect(alerts.settings.get("ws_1")).toMatchObject({
      paidChannelsEnabled: false,
      dailyPaidAlertLimit: 20,
    });

    await alerts.updateSettings("ws_1", { paidChannelsEnabled: true }, NOW);
    const noCredit = await overview.execute({ workspaceId: "ws_1", role: "ADMIN" });
    expect(noCredit.status.pauseReason).toBe("NO_CREDIT");
    expect(noCredit.credit?.balanceCents).toBe(0);
  });
});
