import { defaultAlertSettings } from "../../domain/alerts/types";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import { FixedClock } from "../../shared/clock";
import { decryptSecret } from "../../shared/crypto";
import { FakeAlertRepo } from "../../test/fakes/alerts";
import { FakeBrowserTestRepo } from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import { FakePushDeviceRepo } from "../../test/fakes/push";
import { FakeChannelRepo } from "../../test/fakes/repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import {
  BackfillDefaultPushChannels,
  EnsureDefaultPushChannel,
} from "./ensure_default_push_channel";

const KEY = new Uint8Array(32).fill(5);
const NOW = 1_700_000_000_000;

function browserTest(id: string, workspaceId: string, deletedAt: number | null = null): BrowserTest {
  return {
    id,
    workspaceId,
    name: id,
    startUrl: "https://example.com",
    instructions: "Check the homepage",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 1,
    notifyOnRecovery: true,
    nextRunAt: NOW,
    createdBy: null,
    updatedBy: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt,
  } as BrowserTest;
}

function monitor(id: string, workspaceId: string, deletedAt: number | null = null): UptimeMonitor {
  return {
    id,
    workspaceId,
    name: id,
    url: "https://example.com",
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 0,
    notifyOnRecovery: true,
    nextCheckAt: NOW,
    currentStatus: "UNKNOWN",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt,
  } as UptimeMonitor;
}

async function fixture() {
  const channels = new FakeChannelRepo();
  const alerts = new FakeAlertRepo();
  const tests = new FakeBrowserTestRepo();
  const monitors = new FakeMonitorRepo();
  await tests.insert(browserTest("bt_1", "ws_1"));
  await tests.setChannels("bt_1", ["ch_email"]);
  await tests.insert(browserTest("bt_deleted", "ws_1", 5));
  await tests.insert(browserTest("bt_other", "ws_2"));
  await monitors.insert(monitor("mon_1", "ws_1"));
  await monitors.insert(monitor("mon_other", "ws_2"));
  const ensure = new EnsureDefaultPushChannel(
    channels,
    alerts,
    tests,
    monitors,
    KEY,
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { channels, alerts, tests, monitors, ensure };
}

describe("EnsureDefaultPushChannel", () => {
  it("creates the default push channel once and attaches it to existing tests and monitors", async () => {
    const { channels, alerts, tests, monitors, ensure } = await fixture();

    const first = await ensure.execute({ workspaceId: "ws_1" });
    expect(first.created).toBe(true);
    const channel = await channels.findById("ws_1", first.channelId ?? "");
    expect(channel).toMatchObject({
      type: "PUSH",
      name: "Mobile push",
      enabled: true,
      isDefault: true,
      createdBy: null,
    });
    await expect(decryptSecret(channel?.encryptedConfig ?? "", KEY)).resolves.toBe(
      JSON.stringify({ recipients: "WORKSPACE_MEMBERS" }),
    );
    expect(await tests.getChannelIds("bt_1")).toEqual(["ch_email", first.channelId].sort());
    expect(await tests.getChannelIds("bt_deleted")).toEqual([]);
    expect(await tests.getChannelIds("bt_other")).toEqual([]);
    expect(await monitors.getChannelIds("mon_1")).toEqual([first.channelId]);
    expect(await monitors.getChannelIds("mon_other")).toEqual([]);
    expect(alerts.settings.get("ws_1")?.defaultPushChannelCreatedAt).toBe(NOW);

    await channels.delete(first.channelId ?? "");
    await expect(ensure.execute({ workspaceId: "ws_1" })).resolves.toEqual({
      created: false,
      channelId: null,
    });
    expect(await channels.list("ws_1")).toHaveLength(0);
  });

  it("adopts a push channel that already exists instead of adding a second one", async () => {
    const { channels, alerts, ensure } = await fixture();
    await channels.insert({
      id: "ch_push_manual",
      workspaceId: "ws_1",
      name: "Push",
      type: "PUSH",
      encryptedConfig: "enc",
      enabled: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: "usr_1",
      createdAt: 1,
      updatedAt: 1,
    });
    await expect(ensure.execute({ workspaceId: "ws_1" })).resolves.toEqual({
      created: false,
      channelId: "ch_push_manual",
    });
    expect(await channels.list("ws_1")).toHaveLength(1);
    expect(alerts.settings.get("ws_1")?.defaultPushChannelCreatedAt).toBe(NOW);
  });

  it("backfills workspaces reported by the device repository", async () => {
    const { alerts, channels, ensure } = await fixture();
    const devices = new FakePushDeviceRepo();
    devices.members.set("ws_1", ["usr_a"]);
    devices.members.set("ws_2", ["usr_b"]);
    devices.members.set("ws_marked", ["usr_a"]);
    devices.devices.set("pd_a", {
      id: "pd_a",
      userId: "usr_a",
      token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
      platform: "ios",
      deviceName: null,
      appVersion: null,
      enabled: true,
      disabledReason: null,
      lastSeenAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    devices.markedWorkspaces.add("ws_marked");
    alerts.settings.set("ws_marked", {
      ...defaultAlertSettings("ws_marked", 1),
      defaultPushChannelCreatedAt: 1,
    });

    const backfill = new BackfillDefaultPushChannels(devices, ensure);
    await expect(backfill.execute()).resolves.toEqual({ created: 1 });
    expect(await channels.list("ws_1")).toHaveLength(1);
    expect(await channels.list("ws_2")).toHaveLength(0);
    expect(await channels.list("ws_marked")).toHaveLength(0);
  });
});
