import type { Incident } from "../../domain/incidents/types";
import { FixedClock } from "../../shared/clock";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeIncidentEventRepo,
  FakeIncidentRepo,
} from "../../test/fakes/incident_repos";
import { CloseIncidentOnTestDelete } from "./close_incident_on_test_delete";
import { WriteIncidentNotificationEvent } from "./write_notification_event";

const INCIDENT: Incident = {
  id: "inc_adapter",
  workspaceId: "ws_adapter",
  resourceType: "BROWSER_TEST",
  browserTestId: "bt_adapter",
  uptimeMonitorId: null,
  status: "OPEN",
  openedAt: 100,
  resolvedAt: null,
  openedByRunId: "run_failure",
  resolvedByRunId: null,
  openedByCheckId: null,
  resolvedByCheckId: null,
  lastEventAt: 100,
  createdAt: 100,
};

describe("incident lifecycle adapters", () => {
  it("resolves test deletion with a TEST_DELETED event and no notification seam", async () => {
    const incidents = new FakeIncidentRepo();
    const events = new FakeIncidentEventRepo();
    await incidents.insertOpen(INCIDENT);
    const closer = new CloseIncidentOnTestDelete(
      incidents,
      events,
      new FakeIds(),
    );

    await closer.closeForTest({
      workspaceId: INCIDENT.workspaceId,
      testId: INCIDENT.browserTestId as string,
      at: 200,
    });

    await expect(
      incidents.findById(INCIDENT.workspaceId, INCIDENT.id),
    ).resolves.toMatchObject({ status: "RESOLVED", resolvedAt: 200 });
    await expect(events.listForIncident(INCIDENT.id)).resolves.toMatchObject([
      {
        type: "TEST_DELETED",
        sourceId: INCIDENT.browserTestId,
        createdAt: 200,
      },
    ]);
  });

  it("writes notification status and channel context only for the scoped incident", async () => {
    const incidents = new FakeIncidentRepo();
    const events = new FakeIncidentEventRepo();
    await incidents.insertOpen(INCIDENT);
    const writer = new WriteIncidentNotificationEvent(
      incidents,
      events,
      new FixedClock(300),
      new FakeIds(),
    );

    await writer.write({
      workspaceId: INCIDENT.workspaceId,
      incidentId: INCIDENT.id,
      type: "NOTIFICATION_SENT",
      channelId: "ch_email",
      channelName: "On-call email",
      deliveryId: "del_1",
      status: "SENT",
    });
    await writer.write({
      workspaceId: "ws_other",
      incidentId: INCIDENT.id,
      type: "NOTIFICATION_FAILED",
      channelId: "ch_other",
      channelName: "Wrong workspace",
      deliveryId: "del_2",
      status: "FAILED",
    });

    const timeline = await events.listForIncident(INCIDENT.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: "NOTIFICATION_SENT",
      sourceId: "del_1",
      message: "Notification via On-call email: SENT",
      createdAt: 300,
    });
    expect(JSON.parse(timeline[0]?.metadataJson ?? "{}")).toEqual({
      channelId: "ch_email",
      channelName: "On-call email",
      deliveryId: "del_1",
      status: "SENT",
    });
    await expect(
      incidents.findById(INCIDENT.workspaceId, INCIDENT.id),
    ).resolves.toMatchObject({ lastEventAt: 300 });
  });
});
