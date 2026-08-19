import { describe, expect, it } from "vitest";

import { isTerminalRun } from "./RunStatusPanel";

describe("RunStatusPanel state", () => {
  it("polls only queued and running statuses", () => {
    expect(isTerminalRun("QUEUED")).toBe(false);
    expect(isTerminalRun("RUNNING")).toBe(false);
    for (const status of ["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"] as const) {
      expect(isTerminalRun(status)).toBe(true);
    }
  });
});
