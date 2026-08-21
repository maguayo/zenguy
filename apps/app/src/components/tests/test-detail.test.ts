import { describe, expect, it } from "@jest/globals";

import { parseRunFilter, runFilterItems } from "./test-detail";

describe("test detail run filters", () => {
  it("accepts only API-supported status filters", () => {
    for (const status of ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const) {
      expect(parseRunFilter(status)).toBe(status);
    }
    expect(parseRunFilter(null)).toBe("ALL");
    expect(parseRunFilter(undefined)).toBe("ALL");
    expect(parseRunFilter("RUNNING")).toBe("ALL");
    expect(parseRunFilter("not-a-status")).toBe("ALL");
  });

  it("offers the web's filter tabs in order", () => {
    expect(runFilterItems.map((item) => item.label)).toEqual([
      "All",
      "Passed",
      "Failed",
      "Timeout",
      "System error",
    ]);
  });
});
