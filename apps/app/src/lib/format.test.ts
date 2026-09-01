import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  formatDateTime,
  formatDuration,
  formatFrequency,
  formatInterval,
  formatPct,
  formatRelative,
  formatTime,
} from "./format";

describe("formatters", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("formats date-times in the workspace timezone", () => {
    expect(formatDateTime("2026-08-14T09:32:00.000Z", "UTC")).toBe(
      "14 Aug 2026, 09:32",
    );
    expect(formatDateTime("not-a-date", "UTC")).toBe("—");
  });

  it("formats clock time in the workspace timezone", () => {
    expect(formatTime("2026-08-14T09:32:00.000Z", "Europe/Madrid")).toBe(
      "11:32",
    );
    expect(formatTime("invalid", "UTC")).toBe("—");
  });

  it("formats compact relative times and dates beyond seven days", () => {
    expect(formatRelative("2026-08-19T09:57:00.000Z")).toBe("3m ago");
    expect(formatRelative("2026-08-19T12:00:00.000Z")).toBe("in 2h");
    expect(formatRelative("2026-08-10T12:00:00.000Z")).toContain("10 Aug 2026");
    expect(formatRelative("invalid")).toBe("—");
  });

  it("formats duration boundaries", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_999)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(3_840_000)).toBe("1h 04m");
  });

  it("formats percentages including null and zero", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(99.98)).toBe("99.98%");
  });

  it("formats browser-test intervals", () => {
    expect(formatInterval(1)).toBe("Every hour");
    expect(formatInterval(6)).toBe("Every 6 hours");
  });

  it("formats monitor frequencies", () => {
    expect(formatFrequency(300)).toBe("Every 5 min");
    expect(formatFrequency(3_600)).toBe("Every hour");
    expect(formatFrequency(86_400)).toBe("Every 24 hours");
  });
});
