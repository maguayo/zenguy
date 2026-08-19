import type {
  CheckAverageScope,
  CheckInsertResult,
  CheckRepo,
  CloseMonitorCycle,
  MonitorRepo,
  MonitorUpdate,
} from "../../domain/uptime/repo";
import type {
  ClaimedUptimeMonitor,
  MonitorStatusCounts,
  UptimeCheck,
  UptimeMonitor,
  UptimeSeriesPoint,
} from "../../domain/uptime/types";
import type { Cursor } from "../../shared/pagination";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class FakeMonitorRepo implements MonitorRepo {
  readonly monitors = new Map<string, UptimeMonitor>();
  readonly channelIds = new Map<string, string[]>();

  async insert(monitor: UptimeMonitor): Promise<void> {
    if (this.monitors.has(monitor.id)) {
      throw new Error("uptime monitor constraint violation");
    }
    this.monitors.set(monitor.id, copy(monitor));
  }

  async findById(
    workspaceId: string,
    id: string,
  ): Promise<UptimeMonitor | null> {
    const monitor = this.monitors.get(id);
    return monitor === undefined ||
      monitor.workspaceId !== workspaceId ||
      monitor.deletedAt !== null
      ? null
      : copy(monitor);
  }

  async list(workspaceId: string): Promise<UptimeMonitor[]> {
    return [...this.monitors.values()]
      .filter(
        (monitor) =>
          monitor.workspaceId === workspaceId && monitor.deletedAt === null,
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      )
      .map(copy);
  }

  async update(
    id: string,
    changes: MonitorUpdate,
    at: number,
  ): Promise<void> {
    const monitor = this.monitors.get(id);
    if (monitor === undefined || monitor.deletedAt !== null) return;
    this.monitors.set(id, { ...monitor, ...copy(changes), updatedAt: at });
  }

  async softDelete(id: string, at: number): Promise<void> {
    const monitor = this.monitors.get(id);
    if (monitor === undefined || monitor.deletedAt !== null) return;
    this.monitors.set(id, {
      ...monitor,
      currentCycleId: null,
      cycleStartedAt: null,
      deletedAt: at,
      updatedAt: at,
    });
  }

  async claimDue(
    now: number,
    limit: number,
  ): Promise<ClaimedUptimeMonitor[]> {
    return [...this.monitors.values()]
      .filter(
        (monitor) =>
          monitor.deletedAt === null &&
          monitor.currentCycleId === null &&
          monitor.nextCheckAt <= now,
      )
      .sort(
        (left, right) =>
          left.nextCheckAt - right.nextCheckAt || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((monitor) => {
        const scheduledFor = monitor.nextCheckAt;
        const nextCheckAt = now + monitor.frequencySeconds * 1_000;
        this.monitors.set(monitor.id, { ...monitor, nextCheckAt });
        return { ...copy(monitor), scheduledFor, nextCheckAt };
      });
  }

  async openCycle(id: string, cycleId: string, at: number): Promise<boolean> {
    const monitor = this.monitors.get(id);
    if (
      monitor === undefined ||
      monitor.deletedAt !== null ||
      monitor.currentCycleId !== null
    ) {
      return false;
    }
    this.monitors.set(id, {
      ...monitor,
      currentCycleId: cycleId,
      cycleStartedAt: at,
      updatedAt: at,
    });
    return true;
  }

  async closeCycle(id: string, changes: CloseMonitorCycle): Promise<void> {
    const monitor = this.monitors.get(id);
    if (monitor === undefined || monitor.deletedAt !== null) return;
    this.monitors.set(id, {
      ...monitor,
      currentStatus: changes.status,
      currentCycleId: null,
      cycleStartedAt: null,
      lastCheckAt: changes.lastCheckAt,
      lastResponseTimeMs: changes.lastResponseTimeMs,
      updatedAt: changes.lastCheckAt,
    });
  }

  async listZombieCycles(before: number): Promise<UptimeMonitor[]> {
    return [...this.monitors.values()]
      .filter(
        (monitor) =>
          monitor.currentCycleId !== null &&
          monitor.cycleStartedAt !== null &&
          monitor.cycleStartedAt < before,
      )
      .sort(
        (left, right) =>
          (left.cycleStartedAt as number) - (right.cycleStartedAt as number) ||
          left.id.localeCompare(right.id),
      )
      .map(copy);
  }

  async clearCycle(id: string): Promise<void> {
    const monitor = this.monitors.get(id);
    if (monitor !== undefined) {
      this.monitors.set(id, {
        ...monitor,
        currentCycleId: null,
        cycleStartedAt: null,
      });
    }
  }

  async setChannels(monitorId: string, channelIds: string[]): Promise<void> {
    this.channelIds.set(monitorId, [...new Set(channelIds)].sort());
  }

  async getChannelIds(monitorId: string): Promise<string[]> {
    return [...(this.channelIds.get(monitorId) ?? [])];
  }

  async statusCounts(workspaceId: string): Promise<MonitorStatusCounts> {
    const counts: MonitorStatusCounts = { up: 0, down: 0, unknown: 0 };
    for (const monitor of this.monitors.values()) {
      if (monitor.workspaceId !== workspaceId || monitor.deletedAt !== null) {
        continue;
      }
      if (monitor.currentStatus === "UP") counts.up += 1;
      if (monitor.currentStatus === "DOWN") counts.down += 1;
      if (monitor.currentStatus === "UNKNOWN") counts.unknown += 1;
    }
    return counts;
  }
}

export class FakeCheckRepo implements CheckRepo {
  readonly checks = new Map<string, UptimeCheck>();

  async insertIfAbsent(check: UptimeCheck): Promise<CheckInsertResult> {
    const duplicate = [...this.checks.values()].some(
      (candidate) =>
        candidate.cycleId === check.cycleId &&
        candidate.attemptIndex === check.attemptIndex,
    );
    if (duplicate || this.checks.has(check.id)) return "duplicate";
    this.checks.set(check.id, copy(check));
    return "inserted";
  }

  async listForMonitor(
    monitorId: string,
    cursor: Cursor | null | undefined,
    limit: number,
  ): Promise<UptimeCheck[]> {
    return [...this.checks.values()]
      .filter(
        (check) =>
          check.uptimeMonitorId === monitorId &&
          (cursor === null ||
            cursor === undefined ||
            check.checkedAt < cursor.createdAt ||
            (check.checkedAt === cursor.createdAt && check.id < cursor.id)),
      )
      .sort(
        (left, right) =>
          right.checkedAt - left.checkedAt || right.id.localeCompare(left.id),
      )
      .slice(0, limit)
      .map(copy);
  }

  async seriesSince(
    monitorId: string,
    fromMs: number,
  ): Promise<UptimeSeriesPoint[]> {
    return [...this.checks.values()]
      .filter(
        (check) =>
          check.uptimeMonitorId === monitorId && check.checkedAt >= fromMs,
      )
      .sort(
        (left, right) =>
          left.checkedAt - right.checkedAt || left.id.localeCompare(right.id),
      )
      .map((check) => ({
        checkedAt: check.checkedAt,
        responseTimeMs: check.responseTimeMs,
        status: check.status,
      }));
  }

  async avgResponseTime(
    scope: CheckAverageScope,
    fromMs: number,
  ): Promise<number | null> {
    const values = [...this.checks.values()]
      .filter(
        (check) =>
          check.checkedAt >= fromMs &&
          check.responseTimeMs !== null &&
          ("monitorId" in scope
            ? check.uptimeMonitorId === scope.monitorId
            : check.workspaceId === scope.workspaceId),
      )
      .map((check) => check.responseTimeMs as number);
    return values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  async deleteOlderThan(before: number, limit: number): Promise<number> {
    const ids = [...this.checks.values()]
      .filter((check) => check.checkedAt < before)
      .sort(
        (left, right) =>
          left.checkedAt - right.checkedAt || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((check) => check.id);
    for (const id of ids) this.checks.delete(id);
    return ids.length;
  }
}
