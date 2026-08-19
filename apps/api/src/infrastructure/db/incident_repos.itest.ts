import type {
  Incident,
  IncidentEvent,
} from "../../domain/incidents/types";
import { freshDb, testEnv } from "../../test/helpers";
import { D1IncidentEventRepo } from "./incident_event_repo";
import { D1IncidentRepo } from "./incident_repo";

function testIncident(input: {
  id: string;
  openedAt: number;
  workspaceId?: string;
  testId?: string;
  monitorId?: string;
}): Incident {
  const browserTestId = input.testId ?? null;
  const uptimeMonitorId = input.monitorId ?? null;
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "ws_incidents",
    resourceType:
      browserTestId === null ? "UPTIME_MONITOR" : "BROWSER_TEST",
    browserTestId,
    uptimeMonitorId,
    status: "OPEN",
    openedAt: input.openedAt,
    resolvedAt: null,
    openedByRunId: browserTestId === null ? null : `run_${input.id}`,
    resolvedByRunId: null,
    openedByCheckId: uptimeMonitorId === null ? null : `check_${input.id}`,
    resolvedByCheckId: null,
    lastEventAt: input.openedAt,
    createdAt: input.openedAt,
  };
}

function event(
  id: string,
  incidentId: string,
  createdAt: number,
): IncidentEvent {
  return {
    id,
    incidentId,
    type: "FAILURE_RECORDED",
    sourceId: `run_${id}`,
    message: `Failure ${id}`,
    metadataJson: JSON.stringify({ id }),
    createdAt,
  };
}

describe("D1 incident repositories", () => {
  beforeEach(freshDb);

  it("opens a resource idempotently under concurrent inserts", async () => {
    const first = testIncident({
      id: "inc_first",
      testId: "bt_shared",
      openedAt: 1_000,
    });
    const second = testIncident({
      id: "inc_second",
      testId: "bt_shared",
      openedAt: 1_001,
    });
    const [left, right] = await Promise.all([
      new D1IncidentRepo(testEnv().DB).insertOpen(first),
      new D1IncidentRepo(testEnv().DB).insertOpen(second),
    ]);

    expect(left.id).toBe(right.id);
    expect([first.id, second.id]).toContain(left.id);
    const count = await testEnv()
      .DB.prepare(
        "SELECT COUNT(*) AS count FROM incidents WHERE browser_test_id = ?",
      )
      .bind("bt_shared")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("scopes reads and combines filters with stable keyset pagination", async () => {
    const repo = new D1IncidentRepo(testEnv().DB);
    const oldTest = testIncident({
      id: "inc_old_test",
      testId: "bt_old",
      openedAt: 100,
    });
    const monitor = testIncident({
      id: "inc_monitor",
      monitorId: "mon_1",
      openedAt: 200,
    });
    const resolvedTest = testIncident({
      id: "inc_resolved",
      testId: "bt_resolved",
      openedAt: 300,
    });
    const otherWorkspace = testIncident({
      id: "inc_other",
      testId: "bt_other",
      openedAt: 400,
      workspaceId: "ws_other",
    });
    for (const incident of [oldTest, monitor, resolvedTest, otherWorkspace]) {
      await repo.insertOpen(incident);
    }
    await repo.resolve(resolvedTest.id, 350, { runId: "run_recovery" });
    await repo.touch(oldTest.id, 50);
    await repo.touch(oldTest.id, 175);

    await expect(repo.findById("ws_other", oldTest.id)).resolves.toBeNull();
    await expect(repo.findById("ws_incidents", oldTest.id)).resolves.toMatchObject({
      id: oldTest.id,
      lastEventAt: 175,
    });
    await expect(repo.list("ws_incidents", {}, null, 10)).resolves.toEqual([
      expect.objectContaining({ id: resolvedTest.id }),
      expect.objectContaining({ id: monitor.id }),
      expect.objectContaining({ id: oldTest.id }),
    ]);
    await expect(
      repo.list("ws_incidents", { status: "RESOLVED" }, null, 10),
    ).resolves.toEqual([
      expect.objectContaining({
        id: resolvedTest.id,
        resolvedAt: 350,
        resolvedByRunId: "run_recovery",
      }),
    ]);
    await expect(
      repo.list(
        "ws_incidents",
        { resourceType: "UPTIME_MONITOR", fromMs: 150, toMs: 250 },
        null,
        10,
      ),
    ).resolves.toEqual([expect.objectContaining({ id: monitor.id })]);
    await expect(
      repo.list(
        "ws_incidents",
        {},
        { createdAt: monitor.openedAt, id: monitor.id },
        10,
      ),
    ).resolves.toEqual([expect.objectContaining({ id: oldTest.id })]);
  });

  it("allows the same resource to open again after resolution", async () => {
    const repo = new D1IncidentRepo(testEnv().DB);
    const first = testIncident({
      id: "inc_resolved_first",
      testId: "bt_reopen",
      openedAt: 1_000,
    });
    const reopened = testIncident({
      id: "inc_reopened",
      testId: "bt_reopen",
      openedAt: 2_000,
    });
    await repo.insertOpen(first);
    await repo.resolve(first.id, 1_500, { runId: "run_pass" });
    await expect(repo.insertOpen(reopened)).resolves.toEqual(reopened);
    await expect(repo.findOpenForTest("bt_reopen")).resolves.toEqual(reopened);

    const count = await testEnv()
      .DB.prepare(
        "SELECT COUNT(*) AS count FROM incidents WHERE browser_test_id = ?",
      )
      .bind("bt_reopen")
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it("round-trips incident events in deterministic timeline order", async () => {
    const repo = new D1IncidentEventRepo(testEnv().DB);
    const later = event("evt_z", "inc_timeline", 200);
    const tiedB = event("evt_b", "inc_timeline", 100);
    const tiedA = event("evt_a", "inc_timeline", 100);
    const other = event("evt_other", "inc_other", 50);
    for (const item of [later, tiedB, tiedA, other]) await repo.insert(item);

    await expect(repo.listForIncident("inc_timeline")).resolves.toEqual([
      tiedA,
      tiedB,
      later,
    ]);
  });
});
