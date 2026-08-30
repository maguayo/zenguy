import { describe, expect, it } from "vitest";

import { madridDayWindows } from "./metrics";

describe("Europe/Madrid metric days", () => {
  it("uses a 23-hour UTC range when daylight saving time starts", () => {
    const windows = madridDayWindows(Date.parse("2026-03-30T12:00:00Z"), 2);
    expect(windows[0]).toEqual({
      day: "2026-03-29",
      startMs: Date.parse("2026-03-28T23:00:00Z"),
      endMs: Date.parse("2026-03-29T22:00:00Z"),
    });
    expect((windows[0]?.endMs ?? 0) - (windows[0]?.startMs ?? 0)).toBe(23 * 3_600_000);
  });

  it("uses a 25-hour UTC range when daylight saving time ends", () => {
    const windows = madridDayWindows(Date.parse("2026-10-26T12:00:00Z"), 2);
    expect(windows[0]).toEqual({
      day: "2026-10-25",
      startMs: Date.parse("2026-10-24T22:00:00Z"),
      endMs: Date.parse("2026-10-25T23:00:00Z"),
    });
    expect((windows[0]?.endMs ?? 0) - (windows[0]?.startMs ?? 0)).toBe(25 * 3_600_000);
  });
});
