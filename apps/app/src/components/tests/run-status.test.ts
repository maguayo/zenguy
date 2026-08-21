import { describe, expect, it } from "@jest/globals";

import { attemptCountLabel, attemptSymbol, elapsedMs, isTerminalRun } from "./run-status";

describe("RunStatusPanel state", () => {
  it("polls only queued and running statuses", () => {
    expect(isTerminalRun("QUEUED")).toBe(false);
    expect(isTerminalRun("RUNNING")).toBe(false);
    for (const status of ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const) {
      expect(isTerminalRun(status)).toBe(true);
    }
  });

  it("gives every attempt state a textual symbol", () => {
    expect(attemptSymbol("PASSED")).toBe("✓");
    expect(attemptSymbol("FAILED")).toBe("✗");
    expect(attemptSymbol("TIMEOUT")).toBe("⏱");
    expect(attemptSymbol("SYSTEM_ERROR")).toBe("⚙");
    expect(attemptSymbol("RUNNING")).toBe("…");
    expect(attemptSymbol("STARTING")).toBe("…");
  });

  it("pluralizes the attempt count", () => {
    expect(attemptCountLabel(1)).toBe("1 attempt");
    expect(attemptCountLabel(2)).toBe("2 attempts");
  });

  it("counts live runs from their start and finished runs by duration", () => {
    const startedAt = "2026-08-19T10:00:00.000Z";
    const now = new Date("2026-08-19T10:00:42.000Z").getTime();
    expect(elapsedMs({ durationMs: null, startedAt, status: "RUNNING" }, now)).toBe(42_000);
    expect(elapsedMs({ durationMs: 5_000, startedAt, status: "PASSED" }, now)).toBe(5_000);
    expect(elapsedMs({ durationMs: null, startedAt: null, status: "QUEUED" }, now)).toBeNull();
    expect(
      elapsedMs({ durationMs: null, startedAt, status: "RUNNING" }, now - 100_000),
    ).toBe(0);
  });
});
