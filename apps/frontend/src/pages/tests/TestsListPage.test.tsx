import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { BrowserTest } from "../../api/types";
import { testColumns } from "./TestsListPage";

const test: BrowserTest = {
  channelIds: [],
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: null,
  device: "DESKTOP",
  id: "test_1",
  instructions: "Check the page",
  intervalHours: 6,
  lastRun: null,
  maxRetries: 1,
  name: "Checkout",
  nextRunAt: "2026-08-19T16:00:00.000Z",
  notifyOnRecovery: true,
  openIncidentId: "incident_1",
  startUrl: "https://example.com",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("browser tests table", () => {
  it("keeps the required column order", () => {
    expect(testColumns("ws_1").map((column) => column.key)).toEqual([
      "name",
      "lastStatus",
      "nextRun",
      "incident",
      "actions",
    ]);
  });

  it("renders device, interval, and incident details", () => {
    const columns = testColumns("ws_1");
    const name = renderToStaticMarkup(<>{columns[0]?.render(test)}</>);
    const incident = renderToStaticMarkup(
      <MemoryRouter>{columns[3]?.render(test)}</MemoryRouter>,
    );
    expect(name).toContain("Desktop · Every 6 hours");
    expect(incident).toContain("/w/ws_1/incidents/incident_1");
    expect(incident).toContain("Open");
  });
});
