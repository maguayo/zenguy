import { describe, expect, it } from "vitest";

import { parseRunFilter } from "./TestDetailPage";

describe("test detail run filters", () => {
  it("accepts only API-supported status filters", () => {
    for (const status of ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const) {
      expect(parseRunFilter(status)).toBe(status);
    }
    expect(parseRunFilter(null)).toBe("ALL");
    expect(parseRunFilter("RUNNING")).toBe("ALL");
    expect(parseRunFilter("not-a-status")).toBe("ALL");
  });
});
