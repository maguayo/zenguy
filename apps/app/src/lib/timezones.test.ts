import { describe, expect, it } from "@jest/globals";

import { availableTimezones, filterTimezones, localTimezone, timezoneLabel } from "./timezones";

describe("timezones", () => {
  it("always offers a non-empty list containing UTC", () => {
    const zones = availableTimezones();
    expect(zones.length).toBeGreaterThan(10);
    expect(zones).toContain("UTC");
  });

  it("filters case-insensitively and labels without underscores", () => {
    expect(filterTimezones(["Europe/Madrid", "America/New_York"], "madrid")).toEqual(["Europe/Madrid"]);
    expect(filterTimezones(["Europe/Madrid"], "  ")).toEqual(["Europe/Madrid"]);
    expect(timezoneLabel("America/New_York")).toBe("America/New York");
    expect(typeof localTimezone()).toBe("string");
  });
});
