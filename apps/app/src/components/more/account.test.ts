import { describe, expect, it } from "@jest/globals";

import {
  appUpdateTraceLabel,
  appVersionLabel,
  lockAfterOptions,
  userInitial,
} from "./account";

describe("account screen helpers", () => {
  it("offers every app-lock threshold", () => {
    expect(lockAfterOptions.map((option) => option.value)).toEqual(["immediate", "1m", "5m"]);
    expect(lockAfterOptions.map((option) => option.label)).toEqual([
      "Immediately",
      "1 minute",
      "5 minutes",
    ]);
  });

  it("derives the avatar initial like the web sidebar", () => {
    expect(userInitial({ email: "ada@example.com", name: "Ada Lovelace" })).toBe("A");
    expect(userInitial({ email: "bob@example.com", name: "" })).toBe("B");
    expect(userInitial(null)).toBe("U");
  });

  it("formats the app version caption", () => {
    expect(appVersionLabel("0.1.0", "1")).toBe("Zenguy 0.1.0 (1)");
    expect(appVersionLabel("0.1.0", undefined)).toBe("Zenguy 0.1.0");
    expect(appVersionLabel(undefined, undefined)).toBe("Zenguy");
  });

  it("formats only safe EAS channel and update identifiers", () => {
    expect(
      appUpdateTraceLabel("production", "019f9e33-1234-4abc-8def-0123456789ab"),
    ).toBe("Channel production \u00b7 Update 019f9e33\u2026");
    expect(appUpdateTraceLabel("preview", null)).toBe("Channel preview");
    expect(appUpdateTraceLabel(null, "019F9E33-1234-4ABC-8DEF-0123456789AB")).toBe(
      "Update 019f9e33\u2026",
    );
  });

  it("omits unavailable or malformed EAS trace values", () => {
    expect(appUpdateTraceLabel(null, null)).toBeNull();
    expect(appUpdateTraceLabel("production\nspoofed", "not-an-update-id")).toBeNull();
  });
});
