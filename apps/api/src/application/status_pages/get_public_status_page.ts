import type {
  BrowserTestRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import type { BrowserTest } from "../../domain/browser_tests/types";
import type { IncidentRepo } from "../../domain/incidents/repo";
import type { Incident } from "../../domain/incidents/types";
import type {
  IncidentUpdateRepo,
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import type {
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UptimeMonitor } from "../../domain/uptime/types";
import type { Clock } from "../../shared/clock";
import {
  STATUS_PAGE_HISTORY_DAYS,
  STATUS_PAGE_RECENT_INCIDENT_DAYS,
} from "../../shared/constants";
import { DAY_MS, dailyDowntime, uptimePercent } from "./availability";
import type {
  OverallStatus,
  PublicIncidentView,
  PublicItemState,
  PublicStatusItem,
  PublicStatusPageView,
} from "./types";

interface ResolvedItem {
  item: StatusPageItem;
  monitor: UptimeMonitor | null;
  test: BrowserTest | null;
}

export class GetPublicStatusPage {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly items: StatusPageItemRepo,
    private readonly monitors: Pick<MonitorRepo, "findByIds">,
    private readonly tests: Pick<BrowserTestRepo, "findByIds">,
    private readonly runs: Pick<RunRepo, "testsWithFinishedRuns">,
    private readonly incidents: Pick<IncidentRepo, "listForPublicWindow">,
    private readonly updates: Pick<IncidentUpdateRepo, "listForIncidents">,
    private readonly clock: Clock,
  ) {}

  /** Published pages only — the anonymous public route. */
  async bySlug(slug: string): Promise<PublicStatusPageView | null> {
    const page = await this.pages.findBySlug(slug);
    if (page === null || page.publishedAt === null) return null;
    return this.build(page);
  }

  /** Drafts included — the authenticated preview. */
  async byId(
    workspaceId: string,
    pageId: string,
  ): Promise<PublicStatusPageView | null> {
    const page = await this.pages.findById(workspaceId, pageId);
    if (page === null) return null;
    return this.build(page);
  }

  private async build(page: StatusPage): Promise<PublicStatusPageView> {
    const now = this.clock.now();
    const items = await this.items.listForPage(page.id);
    const monitorIds = items.flatMap((item) =>
      item.uptimeMonitorId === null ? [] : [item.uptimeMonitorId],
    );
    const testIds = items.flatMap((item) =>
      item.browserTestId === null ? [] : [item.browserTestId],
    );
    const [monitors, tests, incidents] = await Promise.all([
      this.monitors.findByIds(page.workspaceId, monitorIds),
      this.tests.findByIds(page.workspaceId, testIds),
      this.incidents.listForPublicWindow(
        page.workspaceId,
        now - STATUS_PAGE_HISTORY_DAYS * DAY_MS,
      ),
    ]);
    const finishedTests = await this.runs.testsWithFinishedRuns(
      page.workspaceId,
      testIds,
    );
    const monitorsById = new Map(monitors.map((entry) => [entry.id, entry]));
    const testsById = new Map(tests.map((entry) => [entry.id, entry]));

    // Items whose resource no longer exists (deleted, or never belonged to
    // this workspace) silently drop from the public view.
    const resolved: ResolvedItem[] = items.flatMap((item) => {
      const monitor =
        item.uptimeMonitorId === null
          ? null
          : (monitorsById.get(item.uptimeMonitorId) ?? null);
      const test =
        item.browserTestId === null
          ? null
          : (testsById.get(item.browserTestId) ?? null);
      if (monitor === null && test === null) return [];
      return [{ item, monitor, test }];
    });

    const incidentsForResource = (entry: ResolvedItem): Incident[] =>
      incidents.filter(
        (candidate) =>
          (entry.monitor !== null &&
            candidate.uptimeMonitorId === entry.monitor.id) ||
          (entry.test !== null && candidate.browserTestId === entry.test.id),
      );

    const publicItems: PublicStatusItem[] = resolved.map((entry) => {
      const resourceIncidents = incidentsForResource(entry);
      const hasOpen = resourceIncidents.some(
        (candidate) => candidate.status === "OPEN",
      );
      const pending =
        entry.monitor !== null
          ? entry.monitor.currentStatus === "UNKNOWN"
          : entry.test !== null && !finishedTests.has(entry.test.id);
      const state: PublicItemState = hasOpen
        ? "DOWN"
        : pending
          ? "PENDING"
          : "OPERATIONAL";
      const createdAt = entry.monitor?.createdAt ?? entry.test?.createdAt ?? now;
      const intervals = resourceIncidents.map((candidate) => ({
        openedAt: candidate.openedAt,
        resolvedAt: candidate.resolvedAt,
      }));
      return {
        id: entry.item.id,
        displayName: entry.item.displayName,
        groupName: entry.item.groupName,
        state,
        uptimePercent:
          state === "PENDING"
            ? null
            : uptimePercent(intervals, now, STATUS_PAGE_HISTORY_DAYS, createdAt),
        days: dailyDowntime(
          intervals,
          now,
          STATUS_PAGE_HISTORY_DAYS,
          createdAt,
        ),
      };
    });

    const active = publicItems.filter((entry) => entry.state !== "PENDING");
    const downCount = active.filter((entry) => entry.state === "DOWN").length;
    const overall: OverallStatus =
      downCount === 0
        ? "OPERATIONAL"
        : downCount === active.length
          ? "MAJOR_OUTAGE"
          : "PARTIAL_OUTAGE";

    const recentCutoff = now - STATUS_PAGE_RECENT_INCIDENT_DAYS * DAY_MS;
    const displayNameByResource = new Map<string, string>();
    for (const entry of resolved) {
      const key = entry.monitor?.id ?? entry.test?.id;
      if (key !== undefined) {
        displayNameByResource.set(key, entry.item.displayName);
      }
    }
    const visibleIncidents = incidents.filter((candidate) => {
      const resourceId = candidate.uptimeMonitorId ?? candidate.browserTestId;
      if (resourceId === null || !displayNameByResource.has(resourceId)) {
        return false;
      }
      if (candidate.status === "OPEN") return true;
      return candidate.resolvedAt !== null && candidate.resolvedAt >= recentCutoff;
    });
    const updatesByIncident = await this.updates.listForIncidents(
      page.workspaceId,
      visibleIncidents.map((candidate) => candidate.id),
    );
    const publicIncidents: PublicIncidentView[] = visibleIncidents
      .map((candidate) => {
        const resourceId =
          candidate.uptimeMonitorId ?? candidate.browserTestId ?? "";
        return {
          displayName: displayNameByResource.get(resourceId) ?? "Unknown",
          status:
            candidate.status === "OPEN"
              ? ("ONGOING" as const)
              : ("RESOLVED" as const),
          startedAt: candidate.openedAt,
          resolvedAt: candidate.resolvedAt,
          durationSeconds: Math.round(
            ((candidate.resolvedAt ?? now) - candidate.openedAt) / 1_000,
          ),
          updates: (updatesByIncident.get(candidate.id) ?? []).map((update) => ({
            message: update.message,
            createdAt: update.createdAt,
          })),
        };
      })
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "ONGOING" ? -1 : 1;
        }
        return right.startedAt - left.startedAt;
      });

    return {
      slug: page.slug,
      title: page.title,
      description: page.description,
      accentColor: page.accentColor,
      theme: page.theme,
      overall,
      items: publicItems,
      incidents: publicIncidents,
      generatedAt: now,
    };
  }
}
