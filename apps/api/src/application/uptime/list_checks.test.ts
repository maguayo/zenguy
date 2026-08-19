import type { UptimeCheck, UptimeMonitor } from "../../domain/uptime/types";
import { FakeCheckRepo, FakeMonitorRepo } from "../../test/fakes/uptime_repos";
import { ListChecks } from "./list_checks";

const MONITOR: UptimeMonitor = {
  id: "mon_history",
  workspaceId: "ws_history",
  name: "History monitor",
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
  maxRetries: 0,
  notifyOnRecovery: true,
  nextCheckAt: 1_000,
  currentStatus: "UP",
  currentCycleId: null,
  cycleStartedAt: null,
  lastCheckAt: 900,
  lastResponseTimeMs: 25,
  createdBy: "usr_history",
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
};

function check(id: string, checkedAt: number): UptimeCheck {
  return {
    id,
    workspaceId: MONITOR.workspaceId,
    uptimeMonitorId: MONITOR.id,
    cycleId: `cyc_${id}`,
    attemptIndex: 0,
    status: "PASSED",
    httpStatus: 200,
    responseTimeMs: 25,
    failureReason: null,
    responseExcerpt: "must not be listed",
    checkedAt,
    createdAt: checkedAt,
  };
}

describe("ListChecks", () => {
  it("paginates by checkedAt and omits internal and excerpt fields", async () => {
    const monitors = new FakeMonitorRepo();
    const checks = new FakeCheckRepo();
    await monitors.insert(MONITOR);
    for (const value of [check("chk_old", 100), check("chk_mid", 200), check("chk_new", 300)]) {
      await checks.insertIfAbsent(value);
    }
    const useCase = new ListChecks(monitors, checks);
    const first = await useCase.execute({
      workspaceId: MONITOR.workspaceId,
      monitorId: MONITOR.id,
      limit: 2,
    });
    expect(first.checks.map((value) => value.id)).toEqual(["chk_new", "chk_mid"]);
    expect(first.checks[0]).not.toHaveProperty("responseExcerpt");
    expect(first.nextCursor).not.toBeNull();
    const second = await useCase.execute({
      workspaceId: MONITOR.workspaceId,
      monitorId: MONITOR.id,
      cursor: first.nextCursor as string,
      limit: 2,
    });
    expect(second.checks.map((value) => value.id)).toEqual(["chk_old"]);
    expect(second.nextCursor).toBeNull();
  });

  it("validates limits and hides monitors from another workspace", async () => {
    const monitors = new FakeMonitorRepo();
    const useCase = new ListChecks(monitors, new FakeCheckRepo());
    await monitors.insert(MONITOR);
    await expect(
      useCase.execute({ workspaceId: MONITOR.workspaceId, monitorId: MONITOR.id, limit: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      useCase.execute({ workspaceId: "ws_other", monitorId: MONITOR.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
