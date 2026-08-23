import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { FakeTrackEvent } from "../../test/fakes/activity";
import { FakeIds } from "../../test/fakes/ids";
import { FakePushDeviceRepo } from "../../test/fakes/push";
import { RegisterPushDevice } from "./register_push_device";

const TOKEN = "ExponentPushToken[abcdefghijklmnopqrstuv]";
const NOW = 1_700_000_000_000;

function workspace(id: string): Workspace {
  return {
    id,
    name: id,
    slug: id,
    timezone: "UTC",
    ownerUserId: "usr_owner",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

function fixture(workspaceIds: string[] = ["ws_1", "ws_2"]) {
  const devices = new FakePushDeviceRepo();
  const ensured: string[] = [];
  const register = new RegisterPushDevice(
    devices,
    {
      listForUser: async () =>
        workspaceIds.map((id) => ({ workspace: workspace(id), role: "OWNER" as const })),
    },
    {
      execute: async ({ workspaceId }) => {
        ensured.push(workspaceId);
        return { created: true, channelId: `ch_${workspaceId}` };
      },
    },
    new FixedClock(NOW),
    new FakeIds(),
  );
  return { devices, ensured, register };
}

describe("RegisterPushDevice", () => {
  it("stores a new device and creates default push channels in every workspace", async () => {
    const { devices, ensured, register } = fixture();
    const device = await register.execute({
      userId: "usr_a",
      token: ` ${TOKEN} `,
      platform: "ios",
      deviceName: "  Marcos's iPhone  ",
      appVersion: "0.1.0",
    });
    expect(device).toMatchObject({
      userId: "usr_a",
      token: TOKEN,
      platform: "ios",
      deviceName: "Marcos's iPhone",
      appVersion: "0.1.0",
      enabled: true,
      disabledReason: null,
      lastSeenAt: NOW,
    });
    expect(device.id.startsWith("pd_")).toBe(true);
    expect(await devices.findByToken(TOKEN)).toMatchObject({ id: device.id });
    expect(ensured).toEqual(["ws_1", "ws_2"]);
  });

  it("re-registers an existing token for the current user and re-enables it", async () => {
    const { devices, register } = fixture();
    const first = await register.execute({ userId: "usr_a", token: TOKEN, platform: "ios" });
    await devices.setEnabled(first.id, false, "DeviceNotRegistered", NOW);

    const second = await register.execute({
      userId: "usr_b",
      token: TOKEN,
      platform: "ios",
      deviceName: "Shared iPhone",
    });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      userId: "usr_b",
      enabled: true,
      disabledReason: null,
      deviceName: "Shared iPhone",
    });
    expect(devices.devices.size).toBe(1);
    expect(await devices.listForUser("usr_a")).toEqual([]);
  });

  it("rejects anything that is not an Expo push token", async () => {
    const { devices, register } = fixture();
    await expect(
      register.execute({ userId: "usr_a", token: "apns:abc", platform: "ios" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ field: "token", message: "Must be an Expo push token" }],
    });
    expect(devices.devices.size).toBe(0);
  });

  it("keeps the registration when a workspace's default channel fails", async () => {
    const devices = new FakePushDeviceRepo();
    const register = new RegisterPushDevice(
      devices,
      { listForUser: async () => [{ workspace: workspace("ws_1"), role: "MEMBER" }] },
      {
        execute: async () => {
          throw new Error("d1 unavailable");
        },
      },
      new FixedClock(NOW),
      new FakeIds(),
    );
    await expect(
      register.execute({ userId: "usr_a", token: TOKEN, platform: "ios" }),
    ).resolves.toMatchObject({ token: TOKEN });
  });
});

describe("RegisterPushDevice activity", () => {
  function tracked(track: FakeTrackEvent): RegisterPushDevice {
    return new RegisterPushDevice(
      new FakePushDeviceRepo(),
      { listForUser: async () => [] },
      { execute: async () => ({ created: false, channelId: null }) },
      new FixedClock(NOW),
      new FakeIds(),
      track,
    );
  }

  it("records push_device.registered in user scope with the platform", async () => {
    const track = new FakeTrackEvent();

    const device = await tracked(track).execute({
      userId: "usr_a",
      token: TOKEN,
      platform: "ios",
    });

    expect(track.calls).toEqual([
      {
        type: "push_device.registered",
        userId: "usr_a",
        source: "server",
        resourceId: device.id,
        properties: { platform: "ios" },
      },
    ]);
  });

  it("records nothing for an invalid token", async () => {
    const track = new FakeTrackEvent();

    await expect(
      tracked(track).execute({ userId: "usr_a", token: "apns:abc", platform: "ios" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(track.calls).toEqual([]);
  });

  it("records a device once, not on every launch re-registration", async () => {
    const track = new FakeTrackEvent();
    const register = tracked(track);

    await register.execute({ userId: "usr_a", token: TOKEN, platform: "ios" });
    await register.execute({ userId: "usr_a", token: TOKEN, platform: "ios" });
    await register.execute({ userId: "usr_b", token: TOKEN, platform: "ios" });

    expect(track.calls).toHaveLength(1);
  });
});
