import type { Incident } from "../../domain/incidents/types";
import type { UptimeMonitor } from "../../domain/uptime/types";
import { createEncryptionKeyring } from "../../shared/crypto";
import { FakeIncidentRepo } from "../../test/fakes/incident_repos";
import { FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { FakeUserRepo } from "../../test/fakes/repos";
import { ListMonitors } from "./list_monitors";

const KEYS = createEncryptionKeyring({
  id: "list-monitors-test",
  key: new Uint8Array(32).fill(9),
});

function monitor(id: string, createdAt: number): UptimeMonitor {
  return {
    id,
    workspaceId: "ws_1",
    name: id,
    url: `https://${id}.example.com/health`,
    method: "GET",
    encryptedHeaders: null,
    encryptedBody: null,
    expectedStatus: 200,
    bodyCondition: null,
    bodyExpectedValue: null,
    bodyConditionPath: null,
    frequencySeconds: 300,
    timeoutSeconds: 10,
    maxRetries: 2,
    notifyOnRecovery: true,
    nextCheckAt: createdAt,
    currentStatus: "UNKNOWN",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: "usr_creator",
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

describe("ListMonitors", () => {
  it("paginates and resolves channels, creators, incidents and ticks in batches", async () => {
    const monitors = new FakeMonitorRepo();
    const incidents = new FakeIncidentRepo();
    const users = new FakeUserRepo();
    users.users.set("usr_creator", {
      id: "usr_creator",
      name: "Creator",
      email: "creator@example.com",
      passwordHash: "hash",
      emailVerifiedAt: 1,
      authVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    for (const value of [
      monitor("mon_old", 1),
      monitor("mon_middle", 2),
      monitor("mon_new", 3),
    ]) {
      await monitors.insert(value);
    }
    await monitors.setChannels("mon_middle", ["ch_2", "ch_1"]);
    monitors.recentChecks.set("mon_new", [
      { id: "chk_1", status: "PASSED", checkedAt: 10 },
    ]);
    const incident: Incident = {
      id: "inc_1",
      workspaceId: "ws_1",
      resourceType: "UPTIME_MONITOR",
      browserTestId: null,
      uptimeMonitorId: "mon_middle",
      status: "OPEN",
      openedAt: 2,
      resolvedAt: null,
      openedByRunId: null,
      resolvedByRunId: null,
      openedByCheckId: "chk_open",
      resolvedByCheckId: null,
      lastEventAt: 2,
      createdAt: 2,
    };
    await incidents.insertOpen(incident);

    const oldChannels = vi.spyOn(monitors, "getChannelIds");
    const oldUsers = vi.spyOn(users, "findById");
    const oldIncidents = vi.spyOn(incidents, "findOpenForMonitor");
    const batchChannels = vi.spyOn(monitors, "getChannelIdsForMonitors");
    const batchUsers = vi.spyOn(users, "findByIds");
    const batchIncidents = vi.spyOn(incidents, "findOpenForMonitors");
    const useCase = new ListMonitors(monitors, incidents, users, KEYS);

    const first = await useCase.execute({
      workspaceId: "ws_1",
      role: "MEMBER",
      limit: 2,
    });
    expect(first.monitors.map(({ id }) => id)).toEqual(["mon_new", "mon_middle"]);
    expect(first.nextCursor).not.toBeNull();
    expect(first.monitors[0]?.recentChecks).toEqual([
      { id: "chk_1", status: "PASSED", checkedAt: 10 },
    ]);
    expect(first.monitors[1]).toMatchObject({
      channelIds: ["ch_1", "ch_2"],
      openIncidentId: "inc_1",
      createdBy: { userId: "usr_creator", name: "Creator" },
    });
    expect(oldChannels).not.toHaveBeenCalled();
    expect(oldUsers).not.toHaveBeenCalled();
    expect(oldIncidents).not.toHaveBeenCalled();
    expect(batchChannels).toHaveBeenCalledTimes(1);
    expect(batchUsers).toHaveBeenCalledTimes(1);
    expect(batchIncidents).toHaveBeenCalledTimes(1);

    const second = await useCase.execute({
      workspaceId: "ws_1",
      role: "MEMBER",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.monitors.map(({ id }) => id)).toEqual(["mon_old"]);
    expect(second.nextCursor).toBeNull();
  });
});
