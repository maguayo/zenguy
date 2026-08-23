import type { IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { Role } from "../../domain/workspaces/types";
import { monitorOutput, type MonitorOutput } from "./types";

/** Ticks shown in the list's history strip. */
const RECENT_CHECKS = 20;

export class ListMonitors {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly incidents: IncidentRepo,
    private readonly users: UserRepo,
    private readonly encryptionKey: Uint8Array,
  ) {}

  async execute(input: {
    workspaceId: string;
    role: Role;
  }): Promise<MonitorOutput[]> {
    const [monitors, recentChecks] = await Promise.all([
      this.monitors.list(input.workspaceId),
      this.monitors.recentChecksPerMonitor(input.workspaceId, RECENT_CHECKS),
    ]);
    return Promise.all(
      monitors.map(async (monitor) => {
        const [channelIds, creator, incident] = await Promise.all([
          this.monitors.getChannelIds(monitor.id),
          monitor.createdBy === null
            ? Promise.resolve(null)
            : this.users.findById(monitor.createdBy),
          this.incidents.findOpenForMonitor(monitor.id),
        ]);
        return monitorOutput({
          monitor,
          channelIds,
          creator,
          incident,
          recentChecks: recentChecks.get(monitor.id) ?? [],
          role: input.role,
          encryptionKey: this.encryptionKey,
        });
      }),
    );
  }
}
