import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge";
import { Badge } from "./ui/Badge";
import { LoadMore } from "./ui/LoadMore";
import { Table } from "./ui/Table";
import { nextTabIndex, Tabs } from "./ui/Tabs";

describe("data display", () => {
  it("renders semantic table headers and rows", () => {
    const html = renderToStaticMarkup(
      <Table
        columns={[{ key: "name", header: "Name", render: (row) => row.name }]}
        rowKey={(row) => row.id}
        rows={[{ id: "1", name: "Checkout" }]}
      />,
    );

    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Checkout");
  });

  it("hides load more without a cursor", () => {
    expect(
      renderToStaticMarkup(
        <LoadMore nextCursor={null} onMore={() => undefined} />,
      ),
    ).toBe("");
  });

  it("renders controlled accessible tabs", () => {
    const html = renderToStaticMarkup(
      <Tabs
        items={[{ key: "all", label: "All", count: 3 }]}
        onChange={() => undefined}
        value="all"
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sections"');
    expect(html).toContain('aria-selected="true"');
  });

  it("wraps tab navigation in both directions", () => {
    expect(nextTabIndex(0, 3, 1)).toBe(1);
    expect(nextTabIndex(2, 3, 1)).toBe(0);
    expect(nextTabIndex(0, 3, -1)).toBe(2);
    expect(nextTabIndex(0, 0, 1)).toBe(-1);
  });

  it("maps every documented status to text", () => {
    const statuses = {
      QUEUED: "Queued",
      STARTING: "Starting",
      RUNNING: "Running",
      CHECKING: "Checking",
      PASSED: "Passed",
      UP: "Up",
      RESOLVED: "Resolved",
      SENT: "Sent",
      FAILED: "Failed",
      DOWN: "Down",
      OPEN: "Open",
      TIMEOUT: "Timeout",
      SYSTEM_ERROR: "System error",
      UNKNOWN: "Unknown",
      PENDING: "Pending",
    } as const;

    for (const [status, label] of Object.entries(statuses)) {
      expect(renderToStaticMarkup(<StatusBadge status={status} />)).toContain(label);
    }
  });

  it("shows the passed-after-retry badge and required tooltip", () => {
    const html = renderToStaticMarkup(
      <StatusBadge passedAfterRetry status="PASSED" />,
    );

    expect(html).toContain("Passed after retry");
    expect(html).toContain(
      "The first attempt failed, but a fresh clean browser completed the test successfully.",
    );
  });

  it("uses semantic badge tones", () => {
    expect(renderToStaticMarkup(<Badge tone="danger">Failed</Badge>)).toContain(
      "bg-danger-50",
    );
  });
});
