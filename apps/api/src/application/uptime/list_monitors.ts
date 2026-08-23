import type { IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { Role } from "../../domain/workspaces/types";
import { monitorOutput, type MonitorOutput } from "./types";
import type { EncryptionKeyring } from "../../shared/crypto";
import { validation } from "../../shared/errors";
import { decodeCursor, encodeCursor } from "../../shared/pagination";

/** Ticks shown in the list's history strip. */
const RECENT_CHECKS = 20;
export const MAX_MONITOR_LIST_PAGE = 100;

export interface MonitorPage {
  monitors: MonitorOutput[];
  nextCursor: string | null;
}

export class ListMonitors {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly incidents: IncidentRepo,
    private readonly users: UserRepo,
    private readonly encryptionKeys: EncryptionKeyring,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
    cursor?: string;
    limit?: number;
  }): Promise<MonitorPage> {
    const limit = input.limit ?? MAX_MONITOR_LIST_PAGE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MONITOR_LIST_PAGE) {
      throw validation([
        {
          field: "limit",
          message: `Must be an integer between 1 and ${MAX_MONITOR_LIST_PAGE}`,
        },
      ]);
    }
    const cursor =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const rows = await this.monitors.listPage(
      input.workspaceId,
      cursor,
      limit + 1,
    );
    const monitors = rows.slice(0, limit);
    const monitorIds = monitors.map((monitor) => monitor.id);
    const creatorIds = monitors.flatMap((monitor) =>
      monitor.createdBy === null ? [] : [monitor.createdBy],
    );
    const [channelIds, creators, openIncidents, recentChecks] = await Promise.all([
      this.monitors.getChannelIdsForMonitors(input.workspaceId, monitorIds),
      this.users.findByIds(creatorIds),
      this.incidents.findOpenForMonitors(input.workspaceId, monitorIds),
      this.monitors.recentChecksPerMonitor(
        input.workspaceId,
        RECENT_CHECKS,
        monitorIds,
      ),
    ]);
    const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));
    const output = await Promise.all(
      monitors.map((monitor) =>
        monitorOutput({
          monitor,
          channelIds: channelIds.get(monitor.id) ?? [],
          creator:
            monitor.createdBy === null
              ? null
              : (creatorsById.get(monitor.createdBy) ?? null),
          incident: openIncidents.get(monitor.id) ?? null,
          recentChecks: recentChecks.get(monitor.id) ?? [],
          role: input.role,
          encryptionKeys: this.encryptionKeys,
        }),
      ),
    );
    const last = monitors.at(-1);
    return {
      monitors: output,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
