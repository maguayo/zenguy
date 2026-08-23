import type { PushDeviceRepo } from "../../domain/push/repo";
import {
  isExpoPushToken,
  type PushDevice,
  type PushPlatform,
} from "../../domain/push/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { validation } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import type { EnsureDefaultPushChannel } from "./ensure_default_push_channel";

export interface RegisterPushDeviceInput {
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceName?: string | null;
  appVersion?: string | null;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/**
 * Registers (or re-registers) the Expo push token of the caller's device.
 * A token belongs to one device: registering it again moves it to the
 * current user, re-enables it and refreshes its metadata. Every workspace the
 * user belongs to is also checked for a missing legacy default push channel.
 */
export class RegisterPushDevice {
  constructor(
    private readonly devices: Pick<
      PushDeviceRepo,
      "findByToken" | "insert" | "reassign" | "findById"
    >,
    private readonly workspaces: Pick<WorkspaceRepo, "listForUser">,
    private readonly defaultChannel: Pick<EnsureDefaultPushChannel, "execute">,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: RegisterPushDeviceInput): Promise<PushDevice> {
    const token = input.token.trim();
    if (!isExpoPushToken(token)) {
      throw validation([
        { field: "token", message: "Must be an Expo push token" },
      ]);
    }
    const now = this.clock.now();
    const metadata = {
      userId: input.userId,
      platform: input.platform,
      deviceName: optionalText(input.deviceName, 80),
      appVersion: optionalText(input.appVersion, 40),
      lastSeenAt: now,
    };
    const existing = await this.devices.findByToken(token);
    let device: PushDevice;
    if (existing === null) {
      device = {
        id: this.ids.newId("pd"),
        token,
        ...metadata,
        enabled: true,
        disabledReason: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.devices.insert(device);
    } else {
      await this.devices.reassign(existing.id, metadata, now);
      device = {
        ...existing,
        ...metadata,
        enabled: true,
        disabledReason: null,
        updatedAt: now,
      };
    }

    for (const { workspace } of await this.workspaces.listForUser(input.userId)) {
      try {
        await this.defaultChannel.execute({ workspaceId: workspace.id });
      } catch {
        logEvent("default_push_channel_failed", { workspaceId: workspace.id });
      }
    }
    return device;
  }
}
