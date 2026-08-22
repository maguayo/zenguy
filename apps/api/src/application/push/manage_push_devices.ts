import type { PushDeviceRepo } from "../../domain/push/repo";
import type { PushDevice } from "../../domain/push/types";
import type { Clock } from "../../shared/clock";
import { notFound } from "../../shared/errors";

export class ListPushDevices {
  constructor(private readonly devices: Pick<PushDeviceRepo, "listForUser">) {}

  execute(input: { userId: string }): Promise<PushDevice[]> {
    return this.devices.listForUser(input.userId);
  }
}

export class UpdatePushDevice {
  constructor(
    private readonly devices: Pick<PushDeviceRepo, "findById" | "setEnabled">,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    deviceId: string;
    enabled: boolean;
  }): Promise<PushDevice> {
    const device = await this.devices.findById(input.userId, input.deviceId);
    if (device === null) throw notFound("Device");
    const now = this.clock.now();
    await this.devices.setEnabled(
      device.id,
      input.enabled,
      input.enabled ? null : "USER_DISABLED",
      now,
    );
    return {
      ...device,
      enabled: input.enabled,
      disabledReason: input.enabled ? null : "USER_DISABLED",
      updatedAt: now,
    };
  }
}

export class RemovePushDevice {
  constructor(private readonly devices: Pick<PushDeviceRepo, "delete">) {}

  async execute(input: { userId: string; deviceId: string }): Promise<void> {
    if (!(await this.devices.delete(input.userId, input.deviceId))) {
      throw notFound("Device");
    }
  }
}
