import type { PushDeviceRepo, PushReach } from "../../domain/push/repo";
import type { PushDevice } from "../../domain/push/types";

function clone<T extends object>(value: T): T {
  return { ...value };
}

export class FakePushDeviceRepo implements PushDeviceRepo {
  readonly devices = new Map<string, PushDevice>();
  /** workspaceId → member user ids, used to resolve tokens per workspace. */
  readonly members = new Map<string, string[]>();

  async findByToken(token: string): Promise<PushDevice | null> {
    for (const device of this.devices.values()) {
      if (device.token === token) return clone(device);
    }
    return null;
  }

  async findById(userId: string, id: string): Promise<PushDevice | null> {
    const device = this.devices.get(id);
    return device === undefined || device.userId !== userId ? null : clone(device);
  }

  async insert(device: PushDevice): Promise<void> {
    if (this.devices.has(device.id) || (await this.findByToken(device.token))) {
      throw new Error("push device constraint violation");
    }
    this.devices.set(device.id, clone(device));
  }

  async reassign(
    id: string,
    changes: Pick<PushDevice, "userId" | "platform" | "deviceName" | "appVersion" | "lastSeenAt">,
    at: number,
  ): Promise<void> {
    const device = this.devices.get(id);
    if (device === undefined) return;
    this.devices.set(id, {
      ...device,
      ...changes,
      enabled: true,
      disabledReason: null,
      updatedAt: at,
    });
  }

  async listForUser(userId: string): Promise<PushDevice[]> {
    return [...this.devices.values()]
      .filter((device) => device.userId === userId)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.id.localeCompare(left.id))
      .map(clone);
  }

  async setEnabled(id: string, enabled: boolean, reason: string | null, at: number): Promise<void> {
    const device = this.devices.get(id);
    if (device === undefined) return;
    this.devices.set(id, { ...device, enabled, disabledReason: enabled ? null : reason, updatedAt: at });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const device = this.devices.get(id);
    if (device === undefined || device.userId !== userId) return false;
    this.devices.delete(id);
    return true;
  }

  private memberDevices(workspaceId: string): PushDevice[] {
    const memberIds = new Set(this.members.get(workspaceId) ?? []);
    return [...this.devices.values()].filter(
      (device) => device.enabled && memberIds.has(device.userId),
    );
  }

  async listEnabledTokensForWorkspace(
    workspaceId: string,
  ): Promise<{ token: string; userId: string }[]> {
    return this.memberDevices(workspaceId).map(({ token, userId }) => ({ token, userId }));
  }

  async reachForWorkspace(workspaceId: string): Promise<PushReach> {
    const devices = this.memberDevices(workspaceId);
    return { devices: devices.length, members: new Set(devices.map((d) => d.userId)).size };
  }

  async disableTokens(tokens: string[], reason: string, at: number): Promise<void> {
    for (const device of this.devices.values()) {
      if (tokens.includes(device.token)) {
        this.devices.set(device.id, { ...device, enabled: false, disabledReason: reason, updatedAt: at });
      }
    }
  }
}
