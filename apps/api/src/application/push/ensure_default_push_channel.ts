import type { AlertRepo } from "../../domain/alerts/repo";
import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import { DEFAULT_PUSH_CHANNEL_NAME } from "../../domain/push/types";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { Clock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { ensureAlertSettings } from "../alerts/settings";

export interface DefaultPushChannelResult {
  created: boolean;
  channelId: string | null;
}

/**
 * Gives every workspace its free "Mobile push" channel exactly once. The
 * channel is preselected for new tests and monitors and attached to every
 * existing one so notifications start flowing as soon as a member registers
 * a device. A deleted channel is never recreated because the settings row
 * remembers the creation.
 */
export class EnsureDefaultPushChannel {
  constructor(
    private readonly channels: Pick<ChannelRepo, "insert" | "list" | "update">,
    private readonly alerts: Pick<
      AlertRepo,
      "findSettings" | "insertSettings" | "updateSettings"
    >,
    private readonly tests: Pick<BrowserTestRepo, "addChannelToAll">,
    private readonly monitors: Pick<MonitorRepo, "addChannelToAll">,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: { workspaceId: string }): Promise<DefaultPushChannelResult> {
    const now = this.clock.now();
    const settings = await ensureAlertSettings(this.alerts, input.workspaceId, now);
    if (settings.defaultPushChannelCreatedAt !== null) {
      return { created: false, channelId: null };
    }
    const existing = (await this.channels.list(input.workspaceId)).find(
      (channel) => channel.type === "PUSH",
    );
    if (existing !== undefined) {
      if (existing.isDefault !== true) {
        await this.channels.update(existing.id, { isDefault: true }, now);
      }
      await this.attachToAll(input.workspaceId, existing.id);
      await this.markCreated(input.workspaceId, now);
      return { created: false, channelId: existing.id };
    }
    const channelId = this.ids.newId("ch");
    await this.channels.insert({
      id: channelId,
      workspaceId: input.workspaceId,
      name: DEFAULT_PUSH_CHANNEL_NAME,
      type: "PUSH",
      encryptedConfig: await encryptSecret(
        JSON.stringify({ recipients: "WORKSPACE_MEMBERS" }),
        this.encryptionKey,
      ),
      enabled: true,
      isDefault: true,
      verifiedAt: null,
      lastDeliveryStatus: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.attachToAll(input.workspaceId, channelId);
    await this.markCreated(input.workspaceId, now);
    logEvent("default_push_channel_created", { workspaceId: input.workspaceId });
    return { created: true, channelId };
  }

  private markCreated(workspaceId: string, now: number): Promise<void> {
    return this.alerts.updateSettings(
      workspaceId,
      { defaultPushChannelCreatedAt: now },
      now,
    );
  }

  private async attachToAll(workspaceId: string, channelId: string): Promise<void> {
    await this.tests.addChannelToAll(workspaceId, channelId);
    await this.monitors.addChannelToAll(workspaceId, channelId);
  }
}

/** Hourly backfill for workspaces created before default push channels existed. */
export class BackfillDefaultPushChannels {
  constructor(
    private readonly alerts: Pick<AlertRepo, "listWorkspaceIdsNeedingDefaultPushChannel">,
    private readonly ensure: Pick<EnsureDefaultPushChannel, "execute">,
    private readonly batchSize = 50,
  ) {}

  async execute(): Promise<{ created: number }> {
    const pending = await this.alerts.listWorkspaceIdsNeedingDefaultPushChannel(
      this.batchSize,
    );
    let created = 0;
    for (const workspaceId of pending) {
      const result = await this.ensure.execute({ workspaceId });
      if (result.created) created += 1;
    }
    return { created };
  }
}
