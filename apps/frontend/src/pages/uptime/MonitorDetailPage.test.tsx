import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Check } from "../../api/types";
import {
  checkColumns,
  expectationSummary,
  monitorHeaderLines,
  recentCheckHistory,
  uptimeTone,
} from "./MonitorDetailPage";

const check: Check = {
  attemptIndex: 0,
  checkedAt: "2026-08-19T10:00:00.000Z",
  cycleId: "cycle_1",
  failureReason: "Expected 200, got 503",
  httpStatus: 503,
  id: "check_1",
  responseTimeMs: 184,
  status: "FAILED",
};

describe("uptime monitor detail", () => {
  it("applies the uptime thresholds exactly", () => {
    expect(uptimeTone(null)).toBe("neutral");
    expect(uptimeTone(99.9)).toBe("ok");
    expect(uptimeTone(99)).toBe("warn");
    expect(uptimeTone(98.99)).toBe("danger");
  });

  it("summarizes status and conditional body expectations", () => {
    expect(
      expectationSummary({
        bodyCondition: "CONTAINS",
        bodyConditionPath: null,
        bodyExpectedValue: "healthy",
        expectedStatus: 200,
      }),
    ).toBe('Status 200 · Body contains "healthy"');
    expect(
      expectationSummary({
        bodyCondition: "JSON_PATH_EQUALS",
        bodyConditionPath: "$.status.healthy",
        bodyExpectedValue: "true",
        expectedStatus: 200,
      }),
    ).toContain('JSON path $.status.healthy equals "true"');
  });

  it("keeps recent-check columns and evidence formatting", () => {
    const columns = checkColumns("UTC");
    expect(columns.map((column) => column.key)).toEqual([
      "time",
      "result",
      "httpStatus",
      "responseTime",
      "reason",
    ]);
    const html = renderToStaticMarkup(
      <>{columns.map((column) => <div key={column.key}>{column.render(check)}</div>)}</>,
    );
    expect(html).toContain("Failed");
    expect(html).toContain("503");
    expect(html).toContain("184 ms");
    expect(html).toContain("Expected 200, got 503");
  });

  it("shows the newest 20 checks oldest-to-newest without mutating API order", () => {
    const checks = Array.from({ length: 24 }, (_, index): Check => ({
      ...check,
      checkedAt: new Date(Date.UTC(2026, 7, 19, 10, index)).toISOString(),
      id: `check_${index}`,
    }));
    const originalOrder = checks.map((item) => item.id);

    expect(recentCheckHistory(checks).map((item) => item.id)).toEqual([
      ...Array.from({ length: 20 }, (_, index) => `check_${19 - index}`),
    ]);
    expect(checks.map((item) => item.id)).toEqual(originalOrder);
  });

  it("never leaks monitor headers to a member", () => {
    expect(monitorHeaderLines({ headers: null, headersMasked: true })).toEqual([
      "Masked for your role",
    ]);
    expect(
      monitorHeaderLines({
        headers: [{ key: "Authorization", value: "Bearer {{API_TOKEN}}" }],
        headersMasked: false,
      }),
    ).toEqual(["Authorization: Bearer {{API_TOKEN}}"]);
    expect(monitorHeaderLines({ headers: [], headersMasked: false })).toEqual(["None"]);
  });
});
