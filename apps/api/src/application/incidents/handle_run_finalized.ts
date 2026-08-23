import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  AttemptRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type {
  ReportGenerator,
  RunFinalizedHandler,
} from "../../domain/browser_tests/ports";
import {
  shouldGenerateReport,
  shouldOpenIncident,
} from "../../domain/browser_tests/run_rules";
import type {
  RunSnapshot,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { ChannelRepo } from "../../domain/channels/repo";
import { buildNotificationMessage } from "../../domain/channels/templates";
import type { IncidentRepo, IncidentEventRepo } from "../../domain/incidents/repo";
import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/ids";
import { platformAlert } from "../../shared/log";
import { truncate } from "../../shared/redact";
import type { TrackEvent } from "../activity/track_event";
import type { DispatchNotifications } from "../channels/dispatch_notifications";

type NotificationDispatch = Pick<DispatchNotifications, "execute">;

export interface HandleRunFinalizedDependencies {
  incidents: IncidentRepo;
  events: IncidentEventRepo;
  runs: Pick<RunRepo, "setIncidentId" | "hasLaterIncidentResult">;
  attempts: Pick<AttemptRepo, "listForRun">;
  dispatchNotifications: NotificationDispatch;
  channels: Pick<ChannelRepo, "listByIds">;
  workspaces: Pick<WorkspaceRepo, "findById">;
  reports: ReportGenerator;
  appUrl: string;
  clock: Clock;
  ids: IdGenerator;
  track?: Pick<TrackEvent, "execute">;
}

function finalAttempt(attempts: TestAttempt[]): TestAttempt | null {
  return [...attempts].sort(
    (left, right) => left.attemptIndex - right.attemptIndex,
  ).at(-1) ?? null;
}

export class HandleRunFinalized implements RunFinalizedHandler {
  constructor(private readonly dependencies: HandleRunFinalizedDependencies) {}

  async handle(run: TestRun, snapshot: RunSnapshot): Promise<void> {
    try {
      await this.handleIncident(run, snapshot);
    } finally {
      await this.generateReportSafely(run);
    }
  }

  private async handleIncident(
    run: TestRun,
    snapshot: RunSnapshot,
  ): Promise<void> {
    const attempts = await this.dependencies.attempts.listForRun(run.id);
    const lastAttempt = finalAttempt(attempts);

    if (run.status === "SYSTEM_ERROR") {
      platformAlert("run_system_error", {
        runId: run.id,
        code: lastAttempt?.systemErrorCode ?? "UNKNOWN",
      });
      return;
    }

    if (
      run.browserTestId !== null &&
      run.finishedAt !== null &&
      (run.status === "PASSED" ||
        run.status === "FAILED" ||
        run.status === "TIMEOUT") &&
      (await this.hasLaterIncidentResult(run))
    ) {
      return;
    }

    if (
      shouldOpenIncident({
        runStatus: run.status,
        source: run.source,
        hasTest: run.browserTestId !== null,
      })
    ) {
      await this.recordFailure(run, snapshot, lastAttempt);
      return;
    }

    if (run.status === "PASSED" && run.browserTestId !== null) {
      await this.recordRecovery(run, snapshot);
    }
  }

  private async recordFailure(
    run: TestRun,
    snapshot: RunSnapshot,
    lastAttempt: TestAttempt | null,
  ): Promise<void> {
    const testId = run.browserTestId as string;
    const at = run.finishedAt ?? this.dependencies.clock.now();
    const [sourceIncident, existing] = await Promise.all([
      this.dependencies.incidents.findByRunSource(run.id),
      this.dependencies.incidents.findOpenForTest(testId),
    ]);
    if (
      sourceIncident !== null &&
      sourceIncident.workspaceId === run.workspaceId &&
      sourceIncident.openedByRunId === run.id
    ) {
      await this.completeOpenedFailure(sourceIncident, run, snapshot, lastAttempt);
      return;
    }
    if (
      existing !== null &&
      existing.workspaceId === run.workspaceId &&
      existing.openedAt <= at
    ) {
      await this.appendFailure(existing, run, at);
      return;
    }

    if (existing !== null) return;

    // Recheck immediately before opening. If a newer terminal run appeared
    // while this continuation was loading incident state, that newer result
    // owns the customer-visible transition.
    if (await this.hasLaterIncidentResult(run)) return;

    const candidate: Incident = {
      id: this.dependencies.ids.newId("inc"),
      workspaceId: run.workspaceId,
      resourceType: "BROWSER_TEST",
      browserTestId: testId,
      uptimeMonitorId: null,
      status: "OPEN",
      openedAt: at,
      resolvedAt: null,
      openedByRunId: run.id,
      resolvedByRunId: null,
      openedByCheckId: null,
      resolvedByCheckId: null,
      lastEventAt: at,
      createdAt: at,
    };
    const opened = await this.dependencies.incidents.insertOpen(candidate);
    if (opened.id !== candidate.id) {
      if (opened.openedAt > at) return;
      await this.appendFailure(opened, run, at);
      return;
    }
    // Only the call that actually inserted the incident records the transition.
    await this.dependencies.track?.execute({
      type: ACTIVITY_EVENTS.incidentOpened,
      userId: null,
      workspaceId: run.workspaceId,
      source: "server",
      resourceId: opened.id,
      properties: { kind: "BROWSER_TEST", browserTestId: testId, runId: run.id },
    });

    if (opened.openedByRunId === run.id) {
      await this.completeOpenedFailure(opened, run, snapshot, lastAttempt);
      return;
    }
    await this.appendFailure(opened, run, at);
  }

  private async completeOpenedFailure(
    incident: Incident,
    run: TestRun,
    snapshot: RunSnapshot,
    lastAttempt: TestAttempt | null,
  ): Promise<void> {
    const at = run.finishedAt ?? this.dependencies.clock.now();
    await this.dependencies.events.insert(
      this.event(incident.id, "OPENED", run.id, this.runMessage(run), at),
    );
    await this.dependencies.runs.setIncidentId(run.id, incident.id);
    await this.dispatch(
      run,
      snapshot,
      incident,
      "FAILURE",
      lastAttempt?.failureReason ?? undefined,
    );
  }

  private async appendFailure(
    incident: Incident,
    run: TestRun,
    at: number,
  ): Promise<void> {
    await this.dependencies.events.insert(
      this.event(
        incident.id,
        "FAILURE_RECORDED",
        run.id,
        this.runMessage(run),
        at,
      ),
    );
    await this.dependencies.incidents.touch(incident.id, at);
    await this.dependencies.runs.setIncidentId(run.id, incident.id);
  }

  private async recordRecovery(
    run: TestRun,
    snapshot: RunSnapshot,
  ): Promise<void> {
    const sourceIncident = await this.dependencies.incidents.findByRunSource(
      run.id,
    );
    const openIncident = await this.dependencies.incidents.findOpenForTest(
      run.browserTestId as string,
    );
    const incident =
      sourceIncident?.resolvedByRunId === run.id
        ? sourceIncident
        : openIncident;
    if (incident === null || incident.workspaceId !== run.workspaceId) return;
    const at = run.finishedAt ?? this.dependencies.clock.now();
    if (incident.openedAt > at) return;
    if (
      incident.status === "RESOLVED" &&
      incident.resolvedByRunId !== run.id
    ) {
      return;
    }
    if (incident.status === "OPEN") {
      await this.dependencies.incidents.resolve(incident.id, at, {
        runId: run.id,
      });
      await this.dependencies.track?.execute({
        type: ACTIVITY_EVENTS.incidentResolved,
        userId: null,
        workspaceId: run.workspaceId,
        source: "server",
        resourceId: incident.id,
        properties: {
          kind: "BROWSER_TEST",
          browserTestId: incident.browserTestId,
          runId: run.id,
        },
      });
    }
    await this.dependencies.events.insert(
      this.event(incident.id, "RESOLVED", run.id, this.runMessage(run), at),
    );
    await this.dependencies.runs.setIncidentId(run.id, incident.id);
    if (snapshot.notifyOnRecovery) {
      await this.dispatch(run, snapshot, incident, "RECOVERY");
    }
  }

  private hasLaterIncidentResult(run: TestRun): Promise<boolean> {
    if (run.browserTestId === null || run.finishedAt === null) {
      return Promise.resolve(false);
    }
    return this.dependencies.runs.hasLaterIncidentResult({
      browserTestId: run.browserTestId,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      runId: run.id,
    });
  }

  private async dispatch(
    run: TestRun,
    snapshot: RunSnapshot,
    incident: Incident,
    eventType: "FAILURE" | "RECOVERY",
    failureSummary?: string,
  ): Promise<void> {
    const [workspace, configuredChannels] = await Promise.all([
      this.dependencies.workspaces.findById(run.workspaceId),
      this.dependencies.channels.listByIds(
        run.workspaceId,
        snapshot.channelIds,
      ),
    ]);
    const enabledIds = configuredChannels
      .filter((channel) => channel.enabled)
      .map((channel) => channel.id);
    if (enabledIds.length === 0) return;
    const occurredAt = run.finishedAt ?? this.dependencies.clock.now();
    await this.dependencies.dispatchNotifications.execute({
      workspaceId: run.workspaceId,
      channelIds: enabledIds,
      incidentId: incident.id,
      dedupeKey: `browser-run:${run.id}:${eventType}`,
      message: buildNotificationMessage({
        eventType,
        resourceType: "BROWSER_TEST",
        resourceName: snapshot.name,
        workspaceName: workspace?.name ?? "Workspace",
        appUrl: this.dependencies.appUrl,
        workspaceId: run.workspaceId,
        incidentId: incident.id,
        runId: run.id,
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
    sourceId: string | null,
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

  private runMessage(run: TestRun): string {
    return `Run ${run.id} finished ${run.status}`;
  }

  private async generateReportSafely(run: TestRun): Promise<void> {
    if (!shouldGenerateReport(run.status)) return;
    try {
      await this.dependencies.reports.generateForRun(run);
    } catch (error) {
      platformAlert("report_generation_failed", { runId: run.id });
      throw error;
    }
  }
}
