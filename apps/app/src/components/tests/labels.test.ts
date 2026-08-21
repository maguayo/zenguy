import { describe, expect, it } from "@jest/globals";

import {
  attemptsLabel,
  deviceDescription,
  deviceLabel,
  retriesLabel,
  testSubtitle,
} from "./labels";

describe("browser test labels", () => {
  it("describes the device and schedule like the web list", () => {
    expect(testSubtitle({ device: "DESKTOP", intervalHours: 6 })).toBe("Desktop · Every 6 hours");
    expect(testSubtitle({ device: "MOBILE", intervalHours: 1 })).toBe("Mobile · Every hour");
    expect(deviceLabel("MOBILE")).toBe("Mobile");
    expect(deviceDescription("DESKTOP")).toBe("Desktop · 1440 × 900");
    expect(deviceDescription("MOBILE")).toBe("Mobile · 390 × 844");
  });

  it("pluralizes retries and counts attempts against the maximum", () => {
    expect(retriesLabel(0)).toBe("0 retries");
    expect(retriesLabel(1)).toBe("1 retry");
    expect(retriesLabel(3)).toBe("3 retries");
    expect(attemptsLabel(2, 1)).toBe("2 of 2");
    expect(attemptsLabel(1, 3)).toBe("1 of 4");
  });
});
