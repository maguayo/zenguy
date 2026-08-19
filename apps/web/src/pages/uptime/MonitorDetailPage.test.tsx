import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Check } from "../../api/types";
import { checkColumns, expectationSummary, uptimeTone } from "./MonitorDetailPage";

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
});
