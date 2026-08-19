import type { Incident, IncidentEvent } from "../../domain/incidents/types";
import {
  FakeIncidentEventRepo,
  FakeIncidentRepo,
} from "./incident_repos";

const INCIDENT: Incident = {
  id: "inc_fake",
  workspaceId: "ws_fake",
  resourceType: "BROWSER_TEST",
  browserTestId: "bt_fake",
  uptimeMonitorId: null,
  status: "OPEN",
  openedAt: 100,
  resolvedAt: null,
  openedByRunId: "run_fail",
  resolvedByRunId: null,
  openedByCheckId: null,
  resolvedByCheckId: null,
  lastEventAt: 100,
  createdAt: 100,
};

describe("incident repository fakes", () => {
  it("mirrors idempotent opens, resolution, re-opening, and keyset lists", async () => {
    const repo = new FakeIncidentRepo();
    await expect(repo.insertOpen(INCIDENT)).resolves.toEqual(INCIDENT);
    await expect(
      repo.insertOpen({ ...INCIDENT, id: "inc_duplicate" }),
    ).resolves.toEqual(INCIDENT);
    await repo.touch(INCIDENT.id, 150);
    await repo.resolve(INCIDENT.id, 200, { runId: "run_pass" });
    const reopened = { ...INCIDENT, id: "inc_reopened", openedAt: 300 };
    await expect(repo.insertOpen(reopened)).resolves.toEqual(reopened);
    await expect(repo.findOpenForTest("bt_fake")).resolves.toEqual(reopened);
    await expect(repo.list("ws_fake", {}, null, 1)).resolves.toEqual([
      reopened,
    ]);
    await expect(
      repo.list(
        "ws_fake",
        {},
        { createdAt: reopened.openedAt, id: reopened.id },
        10,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: INCIDENT.id,
        status: "RESOLVED",
        lastEventAt: 200,
      }),
    ]);
  });

  it("orders event timelines chronologically and returns copies", async () => {
    const repo = new FakeIncidentEventRepo();
    const later: IncidentEvent = {
      id: "evt_later",
      incidentId: INCIDENT.id,
      type: "RESOLVED",
      sourceId: "run_pass",
      message: "Resolved",
      metadataJson: null,
      createdAt: 200,
    };
    const earlier: IncidentEvent = {
      ...later,
      id: "evt_earlier",
      type: "OPENED",
      message: "Opened",
      createdAt: 100,
    };
    await repo.insert(later);
    await repo.insert(earlier);
    const events = await repo.listForIncident(INCIDENT.id);
    expect(events).toEqual([earlier, later]);
    events[0]!.message = "mutated";
    await expect(repo.listForIncident(INCIDENT.id)).resolves.toEqual([
      earlier,
      later,
    ]);
  });
});
