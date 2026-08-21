import { describe, expect, it } from "@jest/globals";

import { defaultPreferences, parsePreferences, shouldLock } from "./AppLockContext";

describe("app lock preferences", () => {
  it("parses stored preferences defensively", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences);
    expect(parsePreferences("not json")).toEqual(defaultPreferences);
    expect(parsePreferences(JSON.stringify({ enabled: true, threshold: "5m" }))).toEqual({
      enabled: true,
      threshold: "5m",
    });
    expect(parsePreferences(JSON.stringify({ enabled: "yes", threshold: "1h" }))).toEqual({
      enabled: false,
      threshold: "1m",
    });
  });

  it("locks only when enabled and the background time exceeds the threshold", () => {
    const enabled = { enabled: true, threshold: "1m" as const };
    expect(shouldLock(enabled, null, 1_000_000)).toBe(false);
    expect(shouldLock(enabled, 1_000_000, 1_030_000)).toBe(false);
    expect(shouldLock(enabled, 1_000_000, 1_060_000)).toBe(true);
    expect(shouldLock({ enabled: true, threshold: "immediate" }, 5, 5)).toBe(true);
    expect(shouldLock({ enabled: false, threshold: "immediate" }, 5, 10)).toBe(false);
  });
});
