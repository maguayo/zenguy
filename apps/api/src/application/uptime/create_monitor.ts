import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { User } from "../../domain/users/types";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, throwIfCollectionCap } from "../../shared/errors";
import type { IdGenerator } from "../../shared/ids";
import type { RateLimiter } from "../../shared/ratelimit";
import type { EncryptionKeyring } from "../../shared/crypto";
import {
  parseMonitorConfig,
  validateMonitorChannelIds,
} from "./input";
import { encryptMonitorSensitive } from "./monitor_secrets";
import { enforceMonitorCreateRate } from "./rate";
import { writeWithActiveDataKeyRetry } from "../security/write_with_active_data_key";
import { monitorOutput, type MonitorOutput } from "./types";

export class CreateMonitor {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly channels: Pick<ChannelRepo, "listByIds">,
    private readonly subscriptions: SubscriptionRepo,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKeys: EncryptionKeyring,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: {
    workspaceId: string;
    actor: User;
    actorRole: Role;
    config: unknown;
    ip?: string;
  }): Promise<MonitorOutput> {
    if (!can(input.actorRole, "uptime.manage")) throw forbidden();
    await ensureActiveSubscription(
      this.subscriptions,
      input.workspaceId,
      this.clock.now(),
    );
    await enforceMonitorCreateRate(
      this.rateLimiter,
      input.workspaceId,
      input.actor.id,
      input.ip,
    );
    const config = parseMonitorConfig(input.config);
    const channelIds = await validateMonitorChannelIds(
      this.channels,
      input.workspaceId,
      config.channelIds,
    );
    const now = this.clock.now();
    const monitorId = this.ids.newId("mon");
    let monitor: UptimeMonitor;
    try {
      monitor = await writeWithActiveDataKeyRetry(
        async () => {
          const encrypted = await encryptMonitorSensitive(
            config,
            this.encryptionKeys,
            { workspaceId: input.workspaceId, monitorId },
          );
          return {
            id: monitorId,
            workspaceId: input.workspaceId,
            name: config.name,
            url: config.url,
            method: config.method,
            ...encrypted,
            expectedStatus: config.expectedStatus,
            bodyCondition: config.bodyCondition ?? null,
            bodyExpectedValue: config.bodyExpectedValue ?? null,
            bodyConditionPath: config.bodyConditionPath ?? null,
            frequencySeconds: config.frequencySeconds,
            timeoutSeconds: config.timeoutSeconds,
            maxRetries: config.maxRetries,
            notifyOnRecovery: config.notifyOnRecovery,
            nextCheckAt: now + config.frequencySeconds * 1_000,
            currentStatus: "UNKNOWN" as const,
            currentCycleId: null,
            cycleStartedAt: null,
            lastCheckAt: null,
            lastResponseTimeMs: null,
            createdBy: input.actor.id,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
        },
        (candidate) => this.monitors.insert(candidate),
      );
    } catch (error) {
      throwIfCollectionCap(error);
      throw error;
    }
    await this.monitors.setChannels(monitor.id, channelIds);
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.monitorCreated,
      resourceType: "uptime_monitor",
      resourceId: monitor.id,
      metadata: { name: monitor.name },
      ip: input.ip,
    });
    return monitorOutput({
      monitor,
      channelIds,
      creator: input.actor,
      incident: null,
      role: input.actorRole,
      encryptionKeys: this.encryptionKeys,
    });
  }
}
