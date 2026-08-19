import { describe, expect, it } from "vitest";

import { attemptSymbol, isTerminalRun } from "./RunStatusPanel";

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
  });
});
