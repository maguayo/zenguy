import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import { FakeCheckRepo, FakeMonitorRepo } from "./uptime_repos";

const MONITOR: UptimeMonitor = {
  id: "mon_fake",
  workspaceId: "ws_fake",
  name: "Fake monitor",
  url: "https://example.com/health",
  method: "GET",
  encryptedHeaders: null,
  encryptedBody: null,
  expectedStatus: 200,
  bodyCondition: null,
  bodyExpectedValue: null,
  bodyConditionPath: null,
  frequencySeconds: 300,
  timeoutSeconds: 10,
  maxRetries: 1,
  notifyOnRecovery: true,
  nextCheckAt: 1_000,
  currentStatus: "UNKNOWN",
  currentCycleId: null,
  cycleStartedAt: null,
  lastCheckAt: null,
  lastResponseTimeMs: null,
  createdBy: "usr_fake",
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
};

function check(id: string, checkedAt: number, attemptIndex = 0): UptimeCheck {
  return {
    id,
    workspaceId: MONITOR.workspaceId,
    uptimeMonitorId: MONITOR.id,
    cycleId: `cyc_${id}`,
    attemptIndex,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs: checkedAt,
    failureReason: null,
    responseExcerpt: null,
    checkedAt,
    createdAt: checkedAt,
  };
}

describe("uptime repository fakes", () => {
  it("claims once, prevents overlapping cycles, and closes state", async () => {
    const repo = new FakeMonitorRepo();
    await repo.insert(MONITOR);
    await expect(repo.claimDue(1_000, 10)).resolves.toMatchObject([
      { id: MONITOR.id, scheduledFor: 1_000, nextCheckAt: 301_000 },
    ]);
    await expect(repo.claimDue(1_000, 10)).resolves.toEqual([]);
    await expect(repo.openCycle(MONITOR.id, "cyc_one", 2_000)).resolves.toBe(
      true,
    );
    await expect(repo.openCycle(MONITOR.id, "cyc_two", 2_001)).resolves.toBe(
      false,
    );
    await expect(repo.listZombieCycles(2_001)).resolves.toMatchObject([
      { id: MONITOR.id, currentCycleId: "cyc_one" },
    ]);
    await repo.closeCycle(MONITOR.id, {
      status: "UP",
      lastCheckAt: 3_000,
      lastResponseTimeMs: 25,
    });
    await expect(repo.findById(MONITOR.workspaceId, MONITOR.id)).resolves.toMatchObject({
      currentStatus: "UP",
      currentCycleId: null,
      lastResponseTimeMs: 25,
    });
  });

  it("deduplicates cycle attempts and mirrors history queries", async () => {
    const repo = new FakeCheckRepo();
    const early = check("chk_early", 100);
    const late = check("chk_late", 300);
    await expect(repo.insertIfAbsent(late)).resolves.toBe("inserted");
    await expect(repo.insertIfAbsent(early)).resolves.toBe("inserted");
    await expect(
      repo.insertIfAbsent({ ...early, id: "chk_duplicate" }),
    ).resolves.toBe("duplicate");
    await expect(repo.listForMonitor(MONITOR.id, null, 10)).resolves.toEqual([
      late,
      early,
    ]);
    await expect(repo.seriesSince(MONITOR.id, 0)).resolves.toEqual([
      { checkedAt: 100, responseTimeMs: 100, status: "PASSED" },
      { checkedAt: 300, responseTimeMs: 300, status: "PASSED" },
    ]);
    await expect(
      repo.avgResponseTime({ monitorId: MONITOR.id }, 0),
    ).resolves.toBe(200);
  });
});
