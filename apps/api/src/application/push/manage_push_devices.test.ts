import { FixedClock } from "../../shared/clock";
import { FakePushDeviceRepo } from "../../test/fakes/push";
import {
  ListPushDevices,
  RemovePushDevice,
  UpdatePushDevice,
} from "./manage_push_devices";

const NOW = 1_700_000_000_000;

function seeded() {
  const devices = new FakePushDeviceRepo();
  devices.devices.set("pd_a", {
    id: "pd_a",
    userId: "usr_a",
    token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
    platform: "ios",
    deviceName: "iPhone",
    appVersion: "0.1.0",
    enabled: true,
    disabledReason: null,
    lastSeenAt: 2,
    createdAt: 1,
    updatedAt: 1,
  });
  return devices;
}

describe("push device management", () => {
  it("lists only the caller's devices", async () => {
    const devices = seeded();
    await expect(new ListPushDevices(devices).execute({ userId: "usr_a" })).resolves.toHaveLength(1);
    await expect(new ListPushDevices(devices).execute({ userId: "usr_b" })).resolves.toEqual([]);
  });

  it("pauses and resumes a device, refusing other users' devices", async () => {
    const devices = seeded();
    const update = new UpdatePushDevice(devices, new FixedClock(NOW));
    await expect(
      update.execute({ userId: "usr_a", deviceId: "pd_a", enabled: false }),
    ).resolves.toMatchObject({ enabled: false, disabledReason: "USER_DISABLED", updatedAt: NOW });
    expect(devices.devices.get("pd_a")?.enabled).toBe(false);
    await expect(
      update.execute({ userId: "usr_a", deviceId: "pd_a", enabled: true }),
    ).resolves.toMatchObject({ enabled: true, disabledReason: null });
    await expect(
      update.execute({ userId: "usr_b", deviceId: "pd_a", enabled: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes a device once", async () => {
    const devices = seeded();
    const remove = new RemovePushDevice(devices);
    await expect(
      remove.execute({ userId: "usr_b", deviceId: "pd_a" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(remove.execute({ userId: "usr_a", deviceId: "pd_a" })).resolves.toBeUndefined();
    await expect(
      remove.execute({ userId: "usr_a", deviceId: "pd_a" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
