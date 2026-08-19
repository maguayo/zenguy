import { decryptMonitorSensitive, encryptMonitorSensitive } from "../../application/uptime/monitor_secrets";
import type { Incident } from "../../domain/incidents/types";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1CheckRepo } from "./check_repo";
import { D1IncidentRepo } from "./incident_repo";
import { D1MonitorRepo } from "./monitor_repo";

const KEY = new Uint8Array(32).fill(5);
const RAW_HEADER = "Bearer database-secret";
const RAW_BODY = '{"token":"body-secret"}';

function monitor(
  id: string,
  overrides: Partial<UptimeMonitor> = {},
): UptimeMonitor {
  return {
    id,
    workspaceId: "ws_uptime_repo",
    name: `Monitor ${id}`,
    url: "https://api.example.com/health",
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
    nextCheckAt: 1_000,
    currentStatus: "UNKNOWN",
    currentCycleId: null,
    cycleStartedAt: null,
    lastCheckAt: null,
    lastResponseTimeMs: null,
    createdBy: "usr_uptime_repo",
    createdAt: 100,
    updatedAt: 100,
    deletedAt: null,
    ...overrides,
  };
}

function check(input: {
  id: string;
  monitorId: string;
  cycleId: string;
  attemptIndex: number;
  checkedAt: number;
  responseTimeMs?: number | null;
}): UptimeCheck {
  return {
    id: input.id,
    workspaceId: "ws_uptime_repo",
    uptimeMonitorId: input.monitorId,
    cycleId: input.cycleId,
    attemptIndex: input.attemptIndex,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs:
      input.responseTimeMs === undefined
        ? input.checkedAt
        : input.responseTimeMs,
    failureReason: null,
    responseExcerpt: null,
    checkedAt: input.checkedAt,
    createdAt: input.checkedAt,
  };
}

describe("D1 uptime repositories", () => {
  beforeEach(freshDb);

  it("encrypts config at rest, claims due monitors without overlapping cycles, and joins incident names", async () => {
    const repo = new D1MonitorRepo(testEnv().DB);
    const encrypted = await encryptMonitorSensitive(
      {
        headers: [{ key: "Authorization", value: RAW_HEADER }],
        body: RAW_BODY,
      },
      KEY,
    );
    const due = monitor("mon_due", {
      ...encrypted,
      name: "API health",
      method: "POST",
    });
    const busy = monitor("mon_busy", { nextCheckAt: 500 });
    const future = monitor("mon_future", { nextCheckAt: 2_000 });
    const deleted = monitor("mon_deleted", { nextCheckAt: 400 });
    for (const value of [due, busy, future, deleted]) await repo.insert(value);
    await repo.softDelete(deleted.id, 800);
    await expect(repo.openCycle(busy.id, "cyc_busy", 700)).resolves.toBe(true);

    const raw = await testEnv()
      .DB.prepare(
        "SELECT encrypted_headers, encrypted_body FROM uptime_monitors WHERE id = ?",
      )
      .bind(due.id)
      .first<{ encrypted_headers: string; encrypted_body: string }>();
    expect(JSON.stringify(raw)).not.toContain(RAW_HEADER);
    expect(JSON.stringify(raw)).not.toContain("body-secret");
    await expect(
      decryptMonitorSensitive(
        {
          encryptedHeaders: raw?.encrypted_headers ?? null,
          encryptedBody: raw?.encrypted_body ?? null,
        },
        KEY,
      ),
    ).resolves.toEqual({
      headers: [{ key: "Authorization", value: RAW_HEADER }],
      body: RAW_BODY,
    });

    await expect(repo.claimDue(1_000, 10)).resolves.toMatchObject([
      { id: due.id, scheduledFor: 1_000, nextCheckAt: 301_000 },
    ]);
    await expect(repo.claimDue(1_000, 10)).resolves.toEqual([]);
    await repo.setChannels(due.id, ["ch_b", "ch_a", "ch_b"]);
    await expect(repo.getChannelIds(due.id)).resolves.toEqual(["ch_a", "ch_b"]);

    const uptimeIncident: Incident = {
      id: "inc_uptime_name",
      workspaceId: due.workspaceId,
      resourceType: "UPTIME_MONITOR",
      browserTestId: null,
      uptimeMonitorId: due.id,
      status: "OPEN",
      openedAt: 1_000,
      resolvedAt: null,
      openedByRunId: null,
      resolvedByRunId: null,
      openedByCheckId: "chk_failure",
      resolvedByCheckId: null,
      lastEventAt: 1_000,
      createdAt: 1_000,
    };
    const incidents = new D1IncidentRepo(testEnv().DB);
    await incidents.insertOpen(uptimeIncident);
    await expect(incidents.list(due.workspaceId, {}, null, 10)).resolves.toMatchObject([
      { id: uptimeIncident.id, resourceName: due.name },
    ]);
  });

  it("makes openCycle atomic and maintains state, zombie, and status reads", async () => {
    const repo = new D1MonitorRepo(testEnv().DB);
    const value = monitor("mon_cycle");
    await repo.insert(value);
    const results = await Promise.all([
      repo.openCycle(value.id, "cyc_first", 1_000),
      repo.openCycle(value.id, "cyc_second", 1_001),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(repo.listZombieCycles(1_100)).resolves.toMatchObject([
      { id: value.id, currentCycleId: expect.stringMatching(/^cyc_/u) },
    ]);
    await repo.closeCycle(value.id, {
      status: "DOWN",
      lastCheckAt: 2_000,
      lastResponseTimeMs: 750,
    });
    await expect(repo.findById(value.workspaceId, value.id)).resolves.toMatchObject({
      currentStatus: "DOWN",
      currentCycleId: null,
      cycleStartedAt: null,
      lastCheckAt: 2_000,
      lastResponseTimeMs: 750,
    });
    await expect(repo.statusCounts(value.workspaceId)).resolves.toEqual({
      up: 0,
      down: 1,
      unknown: 0,
    });
  });

  it("deduplicates checks and provides paginated, chronological, aggregate, and purge reads", async () => {
    const repo = new D1CheckRepo(testEnv().DB);
    const monitorId = "mon_checks";
    const early = check({
      id: "chk_early",
      monitorId,
      cycleId: "cyc_early",
      attemptIndex: 0,
      checkedAt: 100,
    });
    const tiedA = check({
      id: "chk_a_tied",
      monitorId,
      cycleId: "cyc_tied_a",
      attemptIndex: 0,
      checkedAt: 300,
    });
    const tiedZ = check({
      id: "chk_z_tied",
      monitorId,
      cycleId: "cyc_tied_z",
      attemptIndex: 0,
      checkedAt: 300,
      responseTimeMs: null,
    });
    for (const value of [tiedZ, early, tiedA]) {
      await expect(repo.insertIfAbsent(value)).resolves.toBe("inserted");
    }
    await expect(
      repo.insertIfAbsent({ ...early, id: "chk_same_attempt" }),
    ).resolves.toBe("duplicate");
    await expect(repo.listForMonitor(monitorId, null, 2)).resolves.toEqual([
      tiedZ,
      tiedA,
    ]);
    await expect(
      repo.listForMonitor(
        monitorId,
        { createdAt: tiedA.checkedAt, id: tiedA.id },
        10,
      ),
    ).resolves.toEqual([early]);
    await expect(repo.seriesSince(monitorId, 100)).resolves.toEqual([
      { checkedAt: 100, responseTimeMs: 100, status: "PASSED" },
      { checkedAt: 300, responseTimeMs: 300, status: "PASSED" },
      { checkedAt: 300, responseTimeMs: null, status: "PASSED" },
    ]);
    await expect(
      repo.avgResponseTime({ monitorId }, 0),
    ).resolves.toBe(200);
    await expect(
      repo.avgResponseTime({ workspaceId: early.workspaceId }, 0),
    ).resolves.toBe(200);
    await expect(repo.deleteOlderThan(200, 1)).resolves.toBe(1);
    await expect(repo.listForMonitor(monitorId, null, 10)).resolves.toEqual([
      tiedZ,
      tiedA,
    ]);
  });
});
