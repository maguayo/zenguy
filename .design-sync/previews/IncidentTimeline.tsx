import { IncidentTimeline } from "@zenguy/frontend";

const monitorEvents = [
  {
    createdAt: "2024-05-15T09:42:07.000Z",
    id: "iev_01",
    message: "Incident opened — api.aurora-plants.com failed 3 consecutive checks",
    metadata: { checkId: "chk_9f31d2" },
    type: "OPENED" as const,
  },
  {
    createdAt: "2024-05-15T09:42:09.000Z",
    id: "iev_02",
    message: "Failure alert delivered to the on-call channel",
    metadata: { channelName: "On-call email", status: "SENT" },
    type: "NOTIFICATION_SENT" as const,
  },
  {
    createdAt: "2024-05-15T09:42:14.000Z",
    id: "iev_03",
    message: "SMS to +34 ··· 481 could not be delivered",
    metadata: { channelName: "SMS — Marcos", status: "FAILED" },
    type: "NOTIFICATION_FAILED" as const,
  },
  {
    createdAt: "2024-05-15T09:47:12.000Z",
    id: "iev_04",
    message: "Check failed again — HTTP 503 after 2.4 s",
    metadata: { checkId: "chk_9f4a77" },
    type: "FAILURE_RECORDED" as const,
  },
  {
    createdAt: "2024-05-15T10:03:41.000Z",
    id: "iev_05",
    message: "Recovered — 3 consecutive checks passed",
    metadata: null,
    type: "RESOLVED" as const,
  },
];

export const MonitorOutage = () => (
  <div style={{ width: 680 }}>
    <IncidentTimeline
      events={monitorEvents}
      incident={{ resourceId: "mon_api_aurora", resourceType: "UPTIME_MONITOR" }}
      timezone="Europe/Madrid"
      workspaceId="ws_aurora"
    />
  </div>
);

const testEvents = [
  {
    createdAt: "2024-05-15T07:15:33.000Z",
    id: "iev_11",
    message: "Incident opened — “Checkout flow” failed after 2 attempts",
    metadata: { runId: "run_8k2df1" },
    type: "OPENED" as const,
  },
  {
    createdAt: "2024-05-15T07:15:35.000Z",
    id: "iev_12",
    message: "Failure alert posted to Slack",
    metadata: { channelName: "#alerts — Slack", status: "SENT" },
    type: "NOTIFICATION_SENT" as const,
  },
  {
    createdAt: "2024-05-15T08:00:12.000Z",
    id: "iev_13",
    message: "Scheduled retry failed again",
    metadata: { runId: "run_8k9ac4" },
    type: "FAILURE_RECORDED" as const,
  },
  {
    createdAt: "2024-05-15T11:20:02.000Z",
    id: "iev_14",
    message: "The browser test was deleted — incident closed",
    metadata: null,
    type: "TEST_DELETED" as const,
  },
];

export const BrowserTestIncident = () => (
  <div style={{ width: 680 }}>
    <IncidentTimeline
      events={testEvents}
      incident={{ resourceId: "bt_checkout_flow", resourceType: "BROWSER_TEST" }}
      timezone="Europe/Madrid"
      workspaceId="ws_aurora"
    />
  </div>
);
