import { decryptMonitorSensitive, encryptMonitorSensitive } from "../../application/uptime/monitor_secrets";
import type { Incident } from "../../domain/incidents/types";
import type { DurableJob } from "../../domain/durability/types";
import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import { loadConfig } from "../../shared/config";
import { freshDb, testEnv } from "../../test/helpers";
import { D1CheckRepo } from "./check_repo";
import { D1IncidentRepo } from "./incident_repo";
import { D1MonitorRepo } from "./monitor_repo";
import { D1DurableWorkflowRepo } from "./durable_workflow_repo";

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

async function insertWorkspace(): Promise<void> {
  await testEnv()
    .DB.prepare(
      `INSERT INTO workspaces
        (id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at)
       VALUES ('ws_uptime_repo', 'Uptime Repo', 'uptime-repo', 'UTC',
               'usr_uptime_repo', 1, 1, NULL)`,
    )
    .run();
}

describe("D1 uptime repositories", () => {
  beforeEach(freshDb);

  it("lists the recent checks per monitor oldest first, capped per monitor", async () => {
    const monitors = new D1MonitorRepo(testEnv().DB);
    const checks = new D1CheckRepo(testEnv().DB);
    await monitors.insert(monitor("mon_a"));
    await monitors.insert(monitor("mon_b"));
    const failed = {
      ...check({ id: "chk_a2", monitorId: "mon_a", cycleId: "cyc_2", attemptIndex: 0, checkedAt: 200 }),
      status: "FAILED" as const,
    };
    for (const value of [
      check({ id: "chk_a1", monitorId: "mon_a", cycleId: "cyc_1", attemptIndex: 0, checkedAt: 100 }),
      failed,
      check({ id: "chk_a3", monitorId: "mon_a", cycleId: "cyc_3", attemptIndex: 0, checkedAt: 300 }),
      check({ id: "chk_b1", monitorId: "mon_b", cycleId: "cyc_4", attemptIndex: 0, checkedAt: 150 }),
    ]) {
      await checks.insertIfAbsent(value);
    }

    const recent = await monitors.recentChecksPerMonitor("ws_uptime_repo", 2);
    expect(recent.get("mon_a")).toEqual([
      { id: "chk_a2", status: "FAILED", checkedAt: 200 },
      { id: "chk_a3", status: "PASSED", checkedAt: 300 },
    ]);
    expect(recent.get("mon_b")).toEqual([{ id: "chk_b1", status: "PASSED", checkedAt: 150 }]);
    expect(
      await monitors.recentChecksPerMonitor("ws_uptime_repo", 2, ["mon_b"]),
    ).toEqual(
      new Map([
        ["mon_b", [{ id: "chk_b1", status: "PASSED", checkedAt: 150 }]],
      ]),
    );
    expect(await monitors.recentChecksPerMonitor("ws_other", 2)).toEqual(new Map());
    await expect(monitors.listPage("ws_uptime_repo", null, 1)).resolves.toEqual([
      monitor("mon_b"),
    ]);
    await expect(
      monitors.listPage(
        "ws_uptime_repo",
        { createdAt: 100, id: "mon_b" },
        1,
      ),
    ).resolves.toEqual([monitor("mon_a")]);
  });

  it("encrypts config at rest, claims due monitors without overlapping cycles, and joins incident names", async () => {
    await insertWorkspace();
    const encryptionKeys = loadConfig(testEnv()).encryptionKeys;
    const repo = new D1MonitorRepo(testEnv().DB);
    const encrypted = await encryptMonitorSensitive(
      {
        headers: [{ key: "Authorization", value: RAW_HEADER }],
        body: RAW_BODY,
      },
      encryptionKeys,
      { workspaceId: "ws_uptime_repo", monitorId: "mon_due" },
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
          id: due.id,
          workspaceId: due.workspaceId,
          encryptedHeaders: raw?.encrypted_headers ?? null,
          encryptedBody: raw?.encrypted_body ?? null,
        },
        encryptionKeys,
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
    await expect(
      repo.getChannelIdsForMonitors(due.workspaceId, [due.id, busy.id]),
    ).resolves.toEqual(
      new Map([
        [due.id, ["ch_a", "ch_b"]],
        [busy.id, []],
      ]),
    );
    await expect(
      repo.getChannelIdsForMonitors("ws_other", [due.id]),
    ).resolves.toEqual(new Map([[due.id, []]]));

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
    await expect(
      incidents.findOpenForMonitors(due.workspaceId, [due.id, busy.id]),
    ).resolves.toEqual(new Map([[due.id, uptimeIncident]]));
    await expect(
      incidents.findOpenForMonitors("ws_other", [due.id]),
    ).resolves.toEqual(new Map());
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
    const opened = await repo.findById(value.workspaceId, value.id);
    const owningCycle = opened?.currentCycleId;
    if (owningCycle === null || owningCycle === undefined) {
      throw new Error("cycle owner missing");
    }
    await expect(repo.listZombieCycles(1_100)).resolves.toMatchObject([
      { id: value.id, currentCycleId: expect.stringMatching(/^cyc_/u) },
    ]);
    await expect(repo.clearCycle(value.id, "cyc_stale")).resolves.toBe(false);
    await expect(
      repo.closeCycle(
        value.id,
        {
          status: "DOWN",
          lastCheckAt: 2_000,
          lastResponseTimeMs: 750,
        },
        "cyc_stale",
      ),
    ).resolves.toBe(false);
    await expect(
      repo.closeCycle(
        value.id,
        {
          status: "DOWN",
          lastCheckAt: 2_000,
          lastResponseTimeMs: 750,
        },
        owningCycle,
      ),
    ).resolves.toBe(true);
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

  it("leases a check execution before persisting its outcome and continuation", async () => {
    const monitorValue = monitor("mon_check_lease");
    await new D1MonitorRepo(testEnv().DB).insert(monitorValue);
    const durable = new D1DurableWorkflowRepo(testEnv().DB);
    const claim = {
      cycleId: "cyc_check_lease",
      attemptIndex: 0,
      claimedAt: 1_000,
      staleBefore: 0,
    };

    await expect(
      durable.claimCheckExecution({ ...claim, claimToken: "job_owner" }),
    ).resolves.toBe("claimed");
    await expect(
      durable.claimCheckExecution({ ...claim, claimToken: "job_concurrent" }),
    ).resolves.toBe("busy");
    await expect(
      durable.claimCheckExecution({
        ...claim,
        claimToken: "job_takeover",
        claimedAt: 2_000,
        staleBefore: 1_000,
      }),
    ).resolves.toBe("reclaimed");

    const persistedCheck = check({
      id: "chk_leased",
      monitorId: monitorValue.id,
      cycleId: claim.cycleId,
      attemptIndex: claim.attemptIndex,
      checkedAt: 2_000,
    });
    const job: DurableJob = {
      id: "job_check_continuation",
      kind: "CHECK_CONTINUATION",
      aggregateKey: persistedCheck.id,
      payloadJson: JSON.stringify({
        workspaceId: persistedCheck.workspaceId,
        monitorId: persistedCheck.uptimeMonitorId,
        cycleId: persistedCheck.cycleId,
        attemptIndex: persistedCheck.attemptIndex,
        checkId: persistedCheck.id,
        failureSummary: null,
      }),
      status: "PENDING",
      createdAt: 2_000,
      updatedAt: 2_000,
      completedAt: null,
    };
    await expect(
      durable.insertCheckWithJob(persistedCheck, job, "job_owner"),
    ).resolves.toBe("duplicate");
    await expect(
      durable.insertCheckWithJob(persistedCheck, job, "job_takeover"),
    ).resolves.toBe("inserted");
    await expect(
      durable.claimCheckExecution({
        ...claim,
        claimToken: "job_after_completion",
        claimedAt: 3_000,
        staleBefore: 3_000,
      }),
    ).resolves.toBe("completed");
    await expect(
      durable.findJob("CHECK_CONTINUATION", persistedCheck.id),
    ).resolves.toMatchObject({ id: job.id, status: "PENDING" });
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
    await expect(
      repo.findByCycleAttempt(early.cycleId, early.attemptIndex),
    ).resolves.toEqual(early);
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
