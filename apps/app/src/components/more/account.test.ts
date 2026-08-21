import { describe, expect, it } from "@jest/globals";

import { appVersionLabel, lockAfterOptions, userInitial } from "./account";

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
});
