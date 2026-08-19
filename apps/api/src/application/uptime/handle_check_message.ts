import type { ChannelRepo } from "../../domain/channels/repo";
import { buildNotificationMessage } from "../../domain/channels/templates";
import type { IncidentEventRepo, IncidentRepo } from "../../domain/incidents/repo";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { CheckMessage } from "../../domain/queues";
import type { MonitorConfig } from "../../domain/uptime/rules";
import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { RETRY_DELAY_SECONDS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { truncate } from "../../shared/redact";
import type { DispatchNotifications } from "../channels/dispatch_notifications";
import type { CheckOutcome } from "./execute_check";
import { decryptMonitorSensitive } from "./monitor_secrets";

type NotificationDispatch = Pick<DispatchNotifications, "execute">;
type CheckExecutor = (
  config: MonitorConfig,
  workspaceId: string,
) => Promise<CheckOutcome>;

export interface HandleCheckMessageDependencies {
  monitors: MonitorRepo;
  checks: CheckRepo;
  incidents: IncidentRepo;
  events: IncidentEventRepo;
  channels: Pick<ChannelRepo, "listByIds">;
  workspaces: Pick<WorkspaceRepo, "findById">;
  dispatchNotifications: NotificationDispatch;
  checkQueue: Pick<Queue<CheckMessage>, "send">;
  executeCheck: CheckExecutor;
  encryptionKey: Uint8Array;
  appUrl: string;
  clock: Clock;
  ids: IdGenerator;
}

export class HandleCheckMessage {
  constructor(private readonly dependencies: HandleCheckMessageDependencies) {}

  async execute(message: CheckMessage): Promise<void> {
    const [monitor, workspace, existing] = await Promise.all([
      this.dependencies.monitors.findById(message.workspaceId, message.monitorId),
      this.dependencies.workspaces.findById(message.workspaceId),
      this.dependencies.checks.findByCycleAttempt(
        message.cycleId,
        message.attemptIndex,
      ),
    ]);
    if (
      monitor === null ||
      workspace === null ||
      existing !== null ||
      monitor.currentCycleId !== message.cycleId
    ) {
      return;
    }

    const [sensitive, channelIds] = await Promise.all([
      decryptMonitorSensitive(monitor, this.dependencies.encryptionKey),
      this.dependencies.monitors.getChannelIds(monitor.id),
    ]);
    const config = this.executionConfig(monitor, sensitive, channelIds);
    const outcome = await this.dependencies.executeCheck(config, monitor.workspaceId);
    const checkedAt = this.dependencies.clock.now();
    const check: UptimeCheck = {
      id: this.dependencies.ids.newId("chk"),
      workspaceId: monitor.workspaceId,
      uptimeMonitorId: monitor.id,
      cycleId: message.cycleId,
      attemptIndex: message.attemptIndex,
      status: outcome.status,
      httpStatus: outcome.httpStatus,
      responseTimeMs: outcome.responseTimeMs,
      failureReason: outcome.failureReason,
      responseExcerpt: outcome.responseExcerpt,
      checkedAt,
      createdAt: checkedAt,
    };
    if ((await this.dependencies.checks.insertIfAbsent(check)) === "duplicate") {
      return;
    }

    if (outcome.status === "PASSED") {
      await this.recordPass(monitor, check, workspace.name, channelIds);
      return;
    }
    if (message.attemptIndex < monitor.maxRetries) {
      const nextAttemptIndex = message.attemptIndex + 1;
      await this.dependencies.checkQueue.send(
        { ...message, attemptIndex: nextAttemptIndex },
        { delaySeconds: RETRY_DELAY_SECONDS[nextAttemptIndex] ?? 120 },
      );
      return;
    }
    await this.recordFinalFailure(
      monitor,
      check,
      outcome,
      workspace.name,
      channelIds,
    );
  }

  private executionConfig(
    monitor: UptimeMonitor,
    sensitive: Awaited<ReturnType<typeof decryptMonitorSensitive>>,
    channelIds: string[],
  ): MonitorConfig {
    return {
      name: monitor.name,
      url: monitor.url,
      method: monitor.method,
      ...(sensitive.headers === null ? {} : { headers: sensitive.headers }),
      ...(sensitive.body === null ? {} : { body: sensitive.body }),
      expectedStatus: monitor.expectedStatus,
      ...(monitor.bodyCondition === null
        ? {}
        : {
            bodyCondition: monitor.bodyCondition,
            bodyExpectedValue: monitor.bodyExpectedValue ?? "",
          }),
      ...(monitor.bodyConditionPath === null
        ? {}
        : { bodyConditionPath: monitor.bodyConditionPath }),
      frequencySeconds: monitor.frequencySeconds,
      timeoutSeconds: monitor.timeoutSeconds,
      maxRetries: monitor.maxRetries,
      notifyOnRecovery: monitor.notifyOnRecovery,
      channelIds,
    };
  }

  private async recordPass(
    monitor: UptimeMonitor,
    check: UptimeCheck,
    workspaceName: string,
    channelIds: string[],
  ): Promise<void> {
    await this.dependencies.monitors.closeCycle(monitor.id, {
      status: "UP",
      lastCheckAt: check.checkedAt,
      lastResponseTimeMs: check.responseTimeMs,
    });
    const incident = await this.dependencies.incidents.findOpenForMonitor(
      monitor.id,
    );
    if (incident === null || incident.workspaceId !== monitor.workspaceId) return;
    await this.dependencies.incidents.resolve(incident.id, check.checkedAt, {
      checkId: check.id,
    });
    await this.dependencies.events.insert(
      this.event(
        incident.id,
        "RESOLVED",
        check.id,
        `Check ${check.id} finished PASSED`,
        check.checkedAt,
      ),
    );
    if (monitor.notifyOnRecovery) {
      await this.dispatch(
        monitor,
        incident,
        workspaceName,
        channelIds,
        "RECOVERY",
        check.checkedAt,
      );
    }
  }

  private async recordFinalFailure(
    monitor: UptimeMonitor,
    check: UptimeCheck,
    outcome: CheckOutcome,
    workspaceName: string,
    channelIds: string[],
  ): Promise<void> {
    await this.dependencies.monitors.closeCycle(monitor.id, {
      status: "DOWN",
      lastCheckAt: check.checkedAt,
      lastResponseTimeMs: check.responseTimeMs,
    });
    const existing = await this.dependencies.incidents.findOpenForMonitor(
      monitor.id,
    );
    if (existing !== null && existing.workspaceId === monitor.workspaceId) {
      await this.appendFailure(existing, check);
      return;
    }
    const candidate: Incident = {
      id: this.dependencies.ids.newId("inc"),
      workspaceId: monitor.workspaceId,
      resourceType: "UPTIME_MONITOR",
      browserTestId: null,
      uptimeMonitorId: monitor.id,
      status: "OPEN",
      openedAt: check.checkedAt,
      resolvedAt: null,
      openedByRunId: null,
      resolvedByRunId: null,
      openedByCheckId: check.id,
      resolvedByCheckId: null,
      lastEventAt: check.checkedAt,
      createdAt: check.checkedAt,
    };
    const opened = await this.dependencies.incidents.insertOpen(candidate);
    if (opened.id !== candidate.id) {
      await this.appendFailure(opened, check);
      return;
    }
    await this.dependencies.events.insert(
      this.event(
        opened.id,
        "OPENED",
        check.id,
        `Check ${check.id} finished FAILED`,
        check.checkedAt,
      ),
    );
    const failedCondition = outcome.conditions.find(
      (condition) => !condition.passed,
    );
    const failureSummary = `${outcome.failureReason ?? "FAILED"}: ${failedCondition?.detail ?? "check failed"}`;
    await this.dispatch(
      monitor,
      opened,
      workspaceName,
      channelIds,
      "FAILURE",
      check.checkedAt,
      failureSummary,
    );
  }

  private async appendFailure(
    incident: Incident,
    check: UptimeCheck,
  ): Promise<void> {
    await this.dependencies.events.insert(
      this.event(
        incident.id,
        "FAILURE_RECORDED",
        check.id,
        `Check ${check.id} finished FAILED`,
        check.checkedAt,
      ),
    );
    await this.dependencies.incidents.touch(incident.id, check.checkedAt);
  }

  private async dispatch(
    monitor: UptimeMonitor,
    incident: Incident,
    workspaceName: string,
    channelIds: string[],
    eventType: "FAILURE" | "RECOVERY",
    occurredAt: number,
    failureSummary?: string,
  ): Promise<void> {
    const enabledIds = (
      await this.dependencies.channels.listByIds(monitor.workspaceId, channelIds)
    )
      .filter((channel) => channel.enabled)
      .map((channel) => channel.id);
    if (enabledIds.length === 0) return;
    await this.dependencies.dispatchNotifications.execute({
      workspaceId: monitor.workspaceId,
      channelIds: enabledIds,
      incidentId: incident.id,
      message: buildNotificationMessage({
        eventType,
        resourceType: "UPTIME_MONITOR",
        resourceName: monitor.name,
        workspaceName,
        appUrl: this.dependencies.appUrl,
        workspaceId: monitor.workspaceId,
        incidentId: incident.id,
        occurredAtIso: new Date(occurredAt).toISOString(),
        ...(eventType === "RECOVERY"
          ? { durationMs: Math.max(0, occurredAt - incident.openedAt) }
          : failureSummary === undefined
            ? {}
            : { failureSummary: truncate(failureSummary, 2_000) }),
      }),
    });
  }

  private event(
    incidentId: string,
    type: IncidentEvent["type"],
    sourceId: string,
    message: string,
    createdAt: number,
  ): IncidentEvent {
    return {
      id: this.dependencies.ids.newId("evt"),
      incidentId,
      type,
      sourceId,
      message: truncate(message, 2_000),
      metadataJson: null,
      createdAt,
    };
  }
}
