import type { WriteAudit } from "../audit/write_audit";
import { ensureActiveSubscription } from "../billing/ensure_active_subscription";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";
import type { SubscriptionRepo } from "../../domain/billing/repo";
import type { ChannelRepo } from "../../domain/channels/repo";
import type { IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorUpdate, MonitorRepo } from "../../domain/uptime/repo";
import type { User } from "../../domain/users/types";
import type { UserRepo } from "../../domain/users/repo";
import { can } from "../../domain/workspaces/permissions";
import type { Role } from "../../domain/workspaces/types";
import type { Clock } from "../../shared/clock";
import { forbidden, notFound } from "../../shared/errors";
import {
  parseMonitorConfig,
  parseMonitorUpdate,
  validateMonitorChannelIds,
} from "./input";
import {
  decryptMonitorSensitive,
  encryptMonitorSensitive,
} from "./monitor_secrets";
import { monitorOutput, type MonitorOutput } from "./types";

export class UpdateMonitor {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly channels: Pick<ChannelRepo, "listByIds">,
    private readonly incidents: IncidentRepo,
    private readonly subscriptions: SubscriptionRepo,
    private readonly users: UserRepo,
    private readonly audit: Pick<WriteAudit, "execute">,
    private readonly encryptionKey: Uint8Array,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    workspaceId: string;
    monitorId: string;
    actor: User;
    actorRole: Role;
    changes: unknown;
    ip?: string;
  }): Promise<MonitorOutput> {
    if (!can(input.actorRole, "uptime.manage")) throw forbidden();
    await ensureActiveSubscription(this.subscriptions, input.workspaceId);
    const monitor = await this.monitors.findById(
      input.workspaceId,
      input.monitorId,
    );
    if (monitor === null) throw notFound("Uptime monitor");
    const parsed = parseMonitorUpdate(input.changes);
    const [currentChannelIds, sensitive] = await Promise.all([
      this.monitors.getChannelIds(monitor.id),
      decryptMonitorSensitive(monitor, this.encryptionKey),
    ]);
    const method = parsed.method ?? monitor.method;
    const autoClearBody =
      parsed.body === undefined && (method === "GET" || method === "HEAD");
    const condition =
      parsed.bodyCondition === undefined
        ? monitor.bodyCondition
        : parsed.bodyCondition;
    const expectedValue =
      parsed.bodyCondition === null
        ? null
        : parsed.bodyExpectedValue === undefined
          ? monitor.bodyExpectedValue
          : parsed.bodyExpectedValue;
    const conditionPath =
      parsed.bodyCondition === null ||
      (parsed.bodyCondition !== undefined &&
        parsed.bodyCondition !== "JSON_PATH_EQUALS")
        ? null
        : parsed.bodyConditionPath === undefined
          ? monitor.bodyConditionPath
          : parsed.bodyConditionPath;
    const complete = parseMonitorConfig({
      name: parsed.name ?? monitor.name,
      url: parsed.url ?? monitor.url,
      method,
      ...(parsed.headers !== undefined
        ? { headers: parsed.headers }
        : sensitive.headers === null
          ? {}
          : { headers: sensitive.headers }),
      ...(parsed.body !== undefined
        ? { body: parsed.body }
        : autoClearBody || sensitive.body === null
          ? {}
          : { body: sensitive.body }),
      expectedStatus: parsed.expectedStatus ?? monitor.expectedStatus,
      bodyCondition: condition,
      bodyExpectedValue: expectedValue,
      bodyConditionPath: conditionPath,
      frequencySeconds: parsed.frequencySeconds ?? monitor.frequencySeconds,
      timeoutSeconds: parsed.timeoutSeconds ?? monitor.timeoutSeconds,
      maxRetries: parsed.maxRetries ?? monitor.maxRetries,
      notifyOnRecovery:
        parsed.notifyOnRecovery ?? monitor.notifyOnRecovery,
      channelIds: parsed.channelIds ?? currentChannelIds,
    });
    const channelIds =
      parsed.channelIds === undefined
        ? currentChannelIds
        : await validateMonitorChannelIds(
            this.channels,
            input.workspaceId,
            complete.channelIds,
          );
    const now = this.clock.now();
    let encryptedHeaders: string | null | undefined;
    if (parsed.headers !== undefined) {
      encryptedHeaders = (
        await encryptMonitorSensitive(
          { headers: complete.headers ?? [] },
          this.encryptionKey,
        )
      ).encryptedHeaders;
    }
    let encryptedBody: string | null | undefined;
    if (autoClearBody) {
      encryptedBody = null;
    } else if (parsed.body !== undefined) {
      encryptedBody = (
        await encryptMonitorSensitive({ body: complete.body ?? "" }, this.encryptionKey)
      ).encryptedBody;
    }
    const conditionChanged =
      parsed.bodyCondition !== undefined ||
      parsed.bodyExpectedValue !== undefined ||
      parsed.bodyConditionPath !== undefined;
    const changes: MonitorUpdate = {
      ...(parsed.name === undefined ? {} : { name: complete.name }),
      ...(parsed.url === undefined ? {} : { url: complete.url }),
      ...(parsed.method === undefined ? {} : { method: complete.method }),
      ...(encryptedHeaders === undefined ? {} : { encryptedHeaders }),
      ...(encryptedBody === undefined ? {} : { encryptedBody }),
      ...(parsed.expectedStatus === undefined
        ? {}
        : { expectedStatus: complete.expectedStatus }),
      ...(conditionChanged
        ? {
            bodyCondition: complete.bodyCondition ?? null,
            bodyExpectedValue: complete.bodyExpectedValue ?? null,
            bodyConditionPath: complete.bodyConditionPath ?? null,
          }
        : {}),
      ...(parsed.frequencySeconds === undefined
        ? {}
        : {
            frequencySeconds: complete.frequencySeconds,
            nextCheckAt: now + complete.frequencySeconds * 1_000,
          }),
      ...(parsed.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: complete.timeoutSeconds }),
      ...(parsed.maxRetries === undefined
        ? {}
        : { maxRetries: complete.maxRetries }),
      ...(parsed.notifyOnRecovery === undefined
        ? {}
        : { notifyOnRecovery: complete.notifyOnRecovery }),
    };
    await this.monitors.update(monitor.id, changes, now);
    if (parsed.channelIds !== undefined) {
      await this.monitors.setChannels(monitor.id, channelIds);
    }
    const updated = { ...monitor, ...changes, updatedAt: now };
    await this.audit.execute({
      workspaceId: input.workspaceId,
      actorUserId: input.actor.id,
      action: AUDIT_ACTIONS.monitorUpdated,
      resourceType: "uptime_monitor",
      resourceId: monitor.id,
      metadata: {
        name: updated.name,
        changedFields: Object.keys(parsed),
      },
      ip: input.ip,
    });
    const [creator, incident] = await Promise.all([
      updated.createdBy === null
        ? Promise.resolve(null)
        : this.users.findById(updated.createdBy),
      this.incidents.findOpenForMonitor(updated.id),
    ]);
    return monitorOutput({
      monitor: updated,
      channelIds,
      creator,
      incident,
      role: input.actorRole,
      encryptionKey: this.encryptionKey,
    });
  }
}
