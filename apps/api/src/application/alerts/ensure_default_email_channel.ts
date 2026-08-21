import type { AlertRepo } from "../../domain/alerts/repo";
import { DEFAULT_EMAIL_CHANNEL_NAME } from "../../domain/alerts/types";
import type { ChannelRepo } from "../../domain/channels/repo";
import { emailChannelConfigSchema } from "../../domain/channels/types";
import type { Clock } from "../../shared/clock";
import { encryptSecret } from "../../shared/crypto";
import type { IdGenerator } from "../../shared/ids";
import { logEvent } from "../../shared/log";
import { ensureAlertSettings } from "./settings";

export interface DefaultChannelResult {
  created: boolean;
  channelId: string | null;
}

/**
 * Gives a workspace its default, free email channel exactly once: the owner's
 * address, preselected for new tests and monitors. A channel the team later
 * deletes is never recreated because the settings row remembers the creation.
 */
export class EnsureDefaultEmailChannel {
  constructor(
    private readonly channels: Pick<ChannelRepo, "insert" | "list">,
    private readonly alerts: Pick<
      AlertRepo,
      "findSettings" | "insertSettings" | "updateSettings"
    >,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    ownerUserId: string;
    ownerEmail: string;
  }): Promise<DefaultChannelResult> {
    const now = this.clock.now();
    const settings = await ensureAlertSettings(
      this.alerts,
      input.workspaceId,
      now,
    );
    if (settings.defaultEmailChannelCreatedAt !== null) {
      return { created: false, channelId: null };
    }
    const existing = await this.channels.list(input.workspaceId);
    if (existing.length > 0) {
      await this.markCreated(input.workspaceId, now);
      return { created: false, channelId: null };
    }
    const config = emailChannelConfigSchema.safeParse({
      emails: [input.ownerEmail],
    });
    if (!config.success) {
      logEvent("default_email_channel_skipped", {
        workspaceId: input.workspaceId,
      });
      await this.markCreated(input.workspaceId, now);
      return { created: false, channelId: null };
    }
    const channelId = this.ids.newId("ch");
    await this.channels.insert({
      id: channelId,
      workspaceId: input.workspaceId,
      name: DEFAULT_EMAIL_CHANNEL_NAME,
      type: "EMAIL",
      encryptedConfig: await encryptSecret(
        JSON.stringify(config.data),
        this.encryptionKey,
      ),
      enabled: true,
      isDefault: true,
      // The owner's address was verified at sign-up.
      verifiedAt: now,
      lastDeliveryStatus: null,
      createdBy: input.ownerUserId,
      createdAt: now,
      updatedAt: now,
    });
    await this.markCreated(input.workspaceId, now);
    return { created: true, channelId };
  }

  private markCreated(workspaceId: string, now: number): Promise<void> {
    return this.alerts.updateSettings(
      workspaceId,
      { defaultEmailChannelCreatedAt: now },
      now,
    );
  }
}

/** Hourly backfill for workspaces created before default channels existed. */
export class BackfillDefaultEmailChannels {
  constructor(
    private readonly alerts: Pick<AlertRepo, "listWorkspacesNeedingDefaultChannel">,
    private readonly ensure: Pick<EnsureDefaultEmailChannel, "execute">,
    private readonly batchSize = 50,
  ) {}

  async execute(): Promise<{ created: number }> {
    const pending = await this.alerts.listWorkspacesNeedingDefaultChannel(
      this.batchSize,
    );
    let created = 0;
    for (const workspace of pending) {
      const result = await this.ensure.execute(workspace);
      if (result.created) created += 1;
    }
    return { created };
  }
}
