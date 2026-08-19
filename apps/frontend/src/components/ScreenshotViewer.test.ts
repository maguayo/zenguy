import { describe, expect, it } from "vitest";

import { nextScreenshotIndex } from "./ScreenshotViewer";

describe("ScreenshotViewer navigation", () => {
  it("moves within bounds for buttons and arrow keys", () => {
    expect(nextScreenshotIndex(0, 3, 1)).toBe(1);
    expect(nextScreenshotIndex(2, 3, 1)).toBe(2);
    expect(nextScreenshotIndex(2, 3, -1)).toBe(1);
    expect(nextScreenshotIndex(0, 3, -1)).toBe(0);
    expect(nextScreenshotIndex(0, 0, 1)).toBe(0);
  });
});
