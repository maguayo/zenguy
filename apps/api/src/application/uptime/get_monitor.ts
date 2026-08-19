import type { IncidentRepo } from "../../domain/incidents/repo";
import type { MonitorRepo } from "../../domain/uptime/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { Role } from "../../domain/workspaces/types";
import { notFound } from "../../shared/errors";
import { monitorOutput, type MonitorOutput } from "./types";

export class GetMonitor {
  constructor(
    private readonly monitors: MonitorRepo,
    private readonly incidents: IncidentRepo,
    private readonly users: UserRepo,
    private readonly encryptionKey: Uint8Array,
  ) {}

  async execute(input: {
    workspaceId: string;
    monitorId: string;
    role: Role;
  }): Promise<MonitorOutput> {
    const monitor = await this.monitors.findById(
      input.workspaceId,
      input.monitorId,
    );
    if (monitor === null) throw notFound("Uptime monitor");
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
      role: input.role,
      encryptionKey: this.encryptionKey,
    });
  }
}
