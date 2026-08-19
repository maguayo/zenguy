import type { ChannelRepo } from "../../domain/channels/repo";
import { buildNotificationMessage } from "../../domain/channels/templates";
import type { IncidentEventRepo, IncidentRepo } from "../../domain/incidents/repo";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { CheckMessage } from "../../domain/queues";
import type { MonitorConfig } from "../../domain/uptime/rules";
import type { CheckRepo, MonitorRepo } from "../../domain/uptime/repo";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import type { DurableWorkflowRepo } from "../../domain/durability/repo";
import type { DurableJob } from "../../domain/durability/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import { RETRY_DELAY_SECONDS } from "../../shared/constants";
import type { IdGenerator } from "../../shared/ids";
import { truncate } from "../../shared/redact";
import type { DispatchNotifications } from "../channels/dispatch_notifications";
import type { CheckOutcome } from "./execute_check";
import { decryptMonitorSensitive } from "./monitor_secrets";
import { createDurableJob, createOutboxEntry } from "../durability/factory";
import type { PublishQueueOutbox } from "../durability/publish_outbox";
import { platformAlert } from "../../shared/log";

type NotificationDispatch = Pick<DispatchNotifications, "execute">;
type CheckExecutor = (
  config: MonitorConfig,
  workspaceId: string,
) => Promise<CheckOutcome>;

const CHECK_EXECUTION_LEASE_MS = 15 * 60_000;

export interface HandleCheckMessageDependencies {
  monitors: MonitorRepo;
  checks: CheckRepo;
  incidents: IncidentRepo;
  events: IncidentEventRepo;
  channels: Pick<ChannelRepo, "listByIds">;
  workspaces: Pick<WorkspaceRepo, "findById">;
  dispatchNotifications: NotificationDispatch;
  durable: DurableWorkflowRepo;
  outboxPublisher: Pick<PublishQueueOutbox, "publishById">;
  executeCheck: CheckExecutor;
  encryptionKey: Uint8Array;
  appUrl: string;
  clock: Clock;
  ids: IdGenerator;
}

interface CheckContinuationPayload {
  workspaceId: string;
  monitorId: string;
  cycleId: string;
  attemptIndex: number;
  checkId: string;
  failureSummary: string | null;
}

function jobPayload(job: DurableJob): CheckContinuationPayload {
  return JSON.parse(job.payloadJson) as CheckContinuationPayload;
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
    if (monitor === null || workspace === null) return;
    if (existing !== null) {
      const job = await this.dependencies.durable.findJob(
        "CHECK_CONTINUATION",
        existing.id,
      );
      if (job?.status === "PENDING") {
        await this.resumeCheckContinuation(job);
      }
      return;
    }
    if (monitor.currentCycleId !== message.cycleId) return;

    const claimedAt = this.dependencies.clock.now();
    const claimToken = this.dependencies.ids.newId("job");
    const claim = await this.dependencies.durable.claimCheckExecution({
      cycleId: message.cycleId,
      attemptIndex: message.attemptIndex,
      claimToken,
      claimedAt,
      staleBefore: claimedAt - CHECK_EXECUTION_LEASE_MS,
    });
    if (claim !== "claimed") {
      if (claim === "completed") {
        await this.resumePersistedCheck(message);
      }
      return;
    }

    try {
      await this.executeClaimed(message, monitor, claimToken);
    } catch (error) {
      // Ordinary failures release immediately so the Queue retry can run. A
      // Worker crash leaves the durable lease behind and is recovered only
      // after it is stale, fencing the abandoned execution.
      await this.dependencies.durable.releaseCheckExecution({
        cycleId: message.cycleId,
        attemptIndex: message.attemptIndex,
        claimToken,
      });
      throw error;
    }
  }

  private async executeClaimed(
    message: CheckMessage,
    monitor: UptimeMonitor,
    claimToken: string,
  ): Promise<void> {

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
    const failedCondition = outcome.conditions.find(
      (condition) => !condition.passed,
    );
    const failureSummary =
      outcome.status === "PASSED"
        ? null
        : `${outcome.failureReason ?? "FAILED"}: ${failedCondition?.detail ?? "check failed"}`;
    const job = createDurableJob({
      kind: "CHECK_CONTINUATION",
      aggregateKey: check.id,
      payload: {
        workspaceId: message.workspaceId,
        monitorId: message.monitorId,
        cycleId: message.cycleId,
        attemptIndex: message.attemptIndex,
        checkId: check.id,
        failureSummary,
      } satisfies CheckContinuationPayload,
      now: checkedAt,
      ids: this.dependencies.ids,
    });
    const inserted = await this.dependencies.durable.insertCheckWithJob(
      check,
      job,
      claimToken,
    );
    if (inserted === "duplicate") {
      await this.resumePersistedCheck(message);
      return;
    }
    await this.resumeCheckContinuation(job);
  }

  private async resumePersistedCheck(message: CheckMessage): Promise<void> {
    const persisted = await this.dependencies.checks.findByCycleAttempt(
      message.cycleId,
      message.attemptIndex,
    );
    if (persisted === null) return;
    const job = await this.dependencies.durable.findJob(
      "CHECK_CONTINUATION",
      persisted.id,
    );
    if (job?.status === "PENDING") {
      await this.resumeCheckContinuation(job);
    }
  }

  async resumePendingJobs(limit = 100): Promise<void> {
    const jobs = await this.dependencies.durable.listPendingJobs(
      ["CHECK_CONTINUATION"],
      limit,
    );
    for (const job of jobs) {
      try {
        if (job.kind === "CHECK_CONTINUATION") {
          await this.resumeCheckContinuation(job);
        }
      } catch (error) {
        platformAlert("durable_check_job_failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  }

  private async resumeCheckContinuation(job: DurableJob): Promise<void> {
    if (job.status !== "PENDING") return;
    const payload = jobPayload(job);
    const [monitor, workspace, check, channelIds] = await Promise.all([
      this.dependencies.monitors.findById(payload.workspaceId, payload.monitorId),
      this.dependencies.workspaces.findById(payload.workspaceId),
      this.dependencies.checks.findByCycleAttempt(
        payload.cycleId,
        payload.attemptIndex,
      ),
      this.dependencies.monitors.getChannelIds(payload.monitorId),
    ]);
    if (monitor === null || workspace === null || check === null) {
      await this.dependencies.durable.completeJob(
        job.id,
        this.dependencies.clock.now(),
      );
      return;
    }
    if (check.status === "PASSED") {
      await this.recordPass(monitor, check, workspace.name, channelIds);
      await this.dependencies.durable.completeJob(
        job.id,
        this.dependencies.clock.now(),
      );
      return;
    }
    if (payload.attemptIndex < monitor.maxRetries) {
      const nextAttemptIndex = payload.attemptIndex + 1;
      const delaySeconds = RETRY_DELAY_SECONDS[nextAttemptIndex] ?? 120;
      const now = this.dependencies.clock.now();
      const outbox = createOutboxEntry({
        dedupeKey: `check:${payload.cycleId}:${nextAttemptIndex}`,
        queueKind: "CHECK",
        payload: {
          kind: "check",
          monitorId: payload.monitorId,
          workspaceId: payload.workspaceId,
          cycleId: payload.cycleId,
          attemptIndex: nextAttemptIndex,
        } satisfies CheckMessage,
        availableAt: now + delaySeconds * 1_000,
        now,
        ids: this.dependencies.ids,
      });
      await this.dependencies.durable.scheduleCheckRetry({
        jobId: job.id,
        outbox,
        at: now,
      });
      try {
        await this.dependencies.outboxPublisher.publishById(outbox.id);
      } catch {
        platformAlert("check_retry_publish_deferred", {
          checkId: check.id,
          outboxId: outbox.id,
        });
      }
      return;
    }
    await this.recordFinalFailure(
      monitor,
      check,
      workspace.name,
      channelIds,
      payload.failureSummary ?? `${check.failureReason ?? "FAILED"}: check failed`,
    );
    await this.dependencies.durable.completeJob(
      job.id,
      this.dependencies.clock.now(),
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
    const closed = await this.dependencies.monitors.closeCycle(monitor.id, {
      status: "UP",
      lastCheckAt: check.checkedAt,
      lastResponseTimeMs: check.responseTimeMs,
    }, check.cycleId);
    const sourceIncident = await this.dependencies.incidents.findByCheckSource(
      check.id,
    );
    const stale =
      monitor.lastCheckAt !== null && monitor.lastCheckAt > check.checkedAt;
    const canTouchCurrent = closed || monitor.lastCheckAt === check.checkedAt;
    const openIncident = stale || !canTouchCurrent
      ? null
      : await this.dependencies.incidents.findOpenForMonitor(monitor.id);
    const incident =
      sourceIncident?.resolvedByCheckId === check.id
        ? sourceIncident
        : openIncident;
    if (incident === null || incident.workspaceId !== monitor.workspaceId) return;
    if (
      incident.status === "RESOLVED" &&
      incident.resolvedByCheckId !== check.id
    ) return;
    if (incident.status === "OPEN") {
      await this.dependencies.incidents.resolve(incident.id, check.checkedAt, {
        checkId: check.id,
      });
    }
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
        check.id,
      );
    }
  }

  private async recordFinalFailure(
    monitor: UptimeMonitor,
    check: UptimeCheck,
    workspaceName: string,
    channelIds: string[],
    failureSummary: string,
  ): Promise<void> {
    const closed = await this.dependencies.monitors.closeCycle(monitor.id, {
      status: "DOWN",
      lastCheckAt: check.checkedAt,
      lastResponseTimeMs: check.responseTimeMs,
    }, check.cycleId);
    const stale =
      monitor.lastCheckAt !== null && monitor.lastCheckAt > check.checkedAt;
    const canTouchCurrent = closed || monitor.lastCheckAt === check.checkedAt;
    const [sourceIncident, existing] = await Promise.all([
      this.dependencies.incidents.findByCheckSource(check.id),
      stale || !canTouchCurrent
        ? Promise.resolve(null)
        : this.dependencies.incidents.findOpenForMonitor(monitor.id),
    ]);
    if (
      sourceIncident !== null &&
      sourceIncident.workspaceId === monitor.workspaceId &&
      sourceIncident.openedByCheckId === check.id
    ) {
      await this.completeOpenedFailure(
        monitor,
        sourceIncident,
        check,
        workspaceName,
        channelIds,
        failureSummary,
      );
      return;
    }
    if (stale || !canTouchCurrent) return;
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
    if (opened.openedByCheckId !== check.id) {
      await this.appendFailure(opened, check);
      return;
    }
    await this.completeOpenedFailure(
      monitor,
      opened,
      check,
      workspaceName,
      channelIds,
      failureSummary,
    );
  }

  private async completeOpenedFailure(
    monitor: UptimeMonitor,
    opened: Incident,
    check: UptimeCheck,
    workspaceName: string,
    channelIds: string[],
    failureSummary: string,
  ): Promise<void> {
    await this.dependencies.events.insert(
      this.event(
        opened.id,
        "OPENED",
        check.id,
        `Check ${check.id} finished FAILED`,
        check.checkedAt,
      ),
    );
    await this.dispatch(
      monitor,
      opened,
      workspaceName,
      channelIds,
      "FAILURE",
      check.checkedAt,
      check.id,
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
    sourceId: string,
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
      dedupeKey: `uptime-check:${sourceId}:${eventType}`,
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
