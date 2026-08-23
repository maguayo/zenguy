import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatDuration,
  formatNumber,
  percent,
  relativeSeconds,
} from "./format";

describe("format helpers", () => {
  it("formats helper values", () => {
    expect(relativeSeconds(1_000, 4_500)).toBe("3s ago");
    expect(relativeSeconds(1_000, 125_000)).toBe("2m 4s ago");
    expect(relativeSeconds(0, 2 * 3_600_000 + 5_000)).toBe("2h 0m ago");
    expect(formatDuration(64_000)).toBe("1m 04s");
    expect(formatDuration(850)).toBe("0.9s");
    expect(formatDuration(null)).toBe("—");
    expect(percent(0.8333)).toBe("83%");
    expect(percent(null)).toBe("—");
  });

  it("keeps long spans and clock skew readable", () => {
    expect(relativeSeconds(0, 0)).toBe("0s ago");
    expect(relativeSeconds(5_000, 1_000)).toBe("0s ago");
    expect(relativeSeconds(0, 60_000)).toBe("60s ago");
    expect(relativeSeconds(0, 50 * 3_600_000)).toBe("2d 2h ago");
    expect(formatDuration(3 * 3_600_000 + 4 * 60_000)).toBe("3h 04m");
    expect(formatDateTime(Date.UTC(2026, 7, 15, 12, 0))).toContain("Aug 2026");
    expect(formatNumber(12_345)).toBe("12,345");
  });
});
