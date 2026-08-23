import { defaultAlertSettings } from "../../domain/alerts/types";
import { FixedClock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeIds } from "../../test/fakes/ids";
import { FakeChannelRepo } from "../../test/fakes/repos";
import {
  BackfillDefaultEmailChannels,
  EnsureDefaultEmailChannel,
} from "./ensure_default_email_channel";

const KEY = new Uint8Array(32).fill(7);
const NOW = 1_700_000_000_000;

function fixture() {
  const channels = new FakeChannelRepo();
  const alerts = new FakeAlertRepo();
  const ensure = new EnsureDefaultEmailChannel(
    channels,
    alerts,
    KEY,
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { channels, alerts, ensure };
}

describe("EnsureDefaultEmailChannel", () => {
  it("creates a verified default email channel for the owner exactly once", async () => {
    const { channels, alerts, ensure } = fixture();
    const input = {
      workspaceId: "ws_1",
      ownerUserId: "usr_owner",
      ownerEmail: "owner@acme.test",
    };

    const first = await ensure.execute(input);
    expect(first.created).toBe(true);
    const stored = await channels.findById("ws_1", first.channelId ?? "");
    expect(stored).toMatchObject({
      type: "EMAIL",
      name: "Workspace email",
      enabled: true,
      isDefault: true,
      verifiedAt: NOW,
      createdBy: "usr_owner",
    });
    await expect(
      decryptSecret(stored?.encryptedConfig ?? "", KEY),
    ).resolves.toBe(JSON.stringify({ emails: ["owner@acme.test"] }));
    expect(alerts.settings.get("ws_1")).toMatchObject({
      defaultEmailChannelCreatedAt: NOW,
      paidChannelsEnabled: false,
    });

    await channels.delete(first.channelId ?? "");
    const second = await ensure.execute(input);
    expect(second).toEqual({ created: false, channelId: null });
    expect(await channels.list("ws_1")).toHaveLength(0);
  });

  it("does not add a channel to a workspace that already has one", async () => {
    const { channels, alerts, ensure } = fixture();
    await channels.insert({
      id: "ch_slack",
      workspaceId: "ws_1",
      name: "Slack",
      type: "SLACK",
      encryptedConfig: "enc",
      enabled: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await expect(
      ensure.execute({
        workspaceId: "ws_1",
        ownerUserId: "usr_owner",
        ownerEmail: "owner@acme.test",
      }),
    ).resolves.toEqual({ created: false, channelId: null });
    expect(await channels.list("ws_1")).toHaveLength(1);
    expect(alerts.settings.get("ws_1")?.defaultEmailChannelCreatedAt).toBe(NOW);
  });

  it("still creates owner email when the automatic push channel already exists", async () => {
    const { channels, ensure } = fixture();
    await channels.insert({
      id: "ch_push",
      workspaceId: "ws_1",
      name: "Mobile push",
      type: "PUSH",
      encryptedConfig: "enc",
      enabled: true,
      isDefault: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: null,
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      ensure.execute({
        workspaceId: "ws_1",
        ownerUserId: "usr_owner",
        ownerEmail: "owner@acme.test",
      }),
    ).resolves.toMatchObject({ created: true });
    expect((await channels.list("ws_1")).map((channel) => channel.type).sort()).toEqual([
      "EMAIL",
      "PUSH",
    ]);
  });

  it("skips an invalid owner address but never retries it", async () => {
    const { channels, alerts, ensure } = fixture();
    await expect(
      ensure.execute({
        workspaceId: "ws_1",
        ownerUserId: "usr_owner",
        ownerEmail: "not-an-email",
      }),
    ).resolves.toEqual({ created: false, channelId: null });
    expect(await channels.list("ws_1")).toHaveLength(0);
    expect(alerts.settings.get("ws_1")?.defaultEmailChannelCreatedAt).toBe(NOW);
  });

  it("backfills pending workspaces in batches", async () => {
    const { channels, alerts, ensure } = fixture();
    alerts.settings.set("ws_marked", {
      ...defaultAlertSettings("ws_marked", 1),
      defaultEmailChannelCreatedAt: 1,
    });
    alerts.workspacesNeedingDefaultChannel = [
      { workspaceId: "ws_a", ownerUserId: "usr_a", ownerEmail: "a@acme.test" },
      { workspaceId: "ws_b", ownerUserId: "usr_b", ownerEmail: "b@acme.test" },
      { workspaceId: "ws_marked", ownerUserId: "usr_m", ownerEmail: "m@acme.test" },
    ];
    const backfill = new BackfillDefaultEmailChannels(alerts, ensure, 10);

    await expect(backfill.execute()).resolves.toEqual({ created: 2 });
    expect(await channels.list("ws_a")).toHaveLength(1);
    expect(await channels.list("ws_b")).toHaveLength(1);
    expect(await channels.list("ws_marked")).toHaveLength(0);
  });
});
