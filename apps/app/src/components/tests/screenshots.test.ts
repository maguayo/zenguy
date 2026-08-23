import { describe, expect, it } from "@jest/globals";

import type { Attempt } from "@/api/types";
import { clampScreenshotIndex, nextScreenshotIndex, screenshotItems } from "./screenshots";

function attempt(): Attempt {
  return {
    actualResult: null,
    attemptIndex: 0,
    consoleErrors: [],
    durationMs: 2_000,
    expectedResult: null,
    failureReason: null,
    finishedAt: "2026-08-19T10:00:02.000Z",
    id: "attempt_1",
    inputTokens: null,
    latestScreenshot: null,
    latestStep: null,
    modelName: "gpt-5-nano",
    networkErrors: [],
    outputTokens: null,
    queuedAt: "2026-08-19T10:00:00.000Z",
    retryDelaySeconds: 0,
    runnerKind: null,
    runnerVersion: "1.0.0",
    screenshots: [
      { expiresAt: "2026-08-20T10:00:00.000Z", id: "shot_1", url: "https://example.com/1.png" },
      { expiresAt: "2026-08-20T10:00:00.000Z", id: "shot_2", url: "https://example.com/2.png" },
    ],
    startedAt: "2026-08-19T10:00:00.000Z",
    status: "PASSED",
    steps: [
      {
        actionType: "click",
        description: "Opened the cart",
        result: "OK",
        screenshot: {
          expiresAt: "2026-08-20T10:00:00.000Z",
          id: "shot_1",
          url: "https://example.com/1.png",
        },
        sequence: 1,
        timestamp: "2026-08-19T10:00:01.000Z",
        urlSanitized: "https://example.com/cart",
      },
    ],
    summary: "The cart opened.",
    systemErrorCode: null,
    tokenUsage: 123,
    visitedUrls: [],
  };
}

describe("ScreenshotViewer navigation", () => {
  it("moves within bounds for the previous and next buttons", () => {
    expect(nextScreenshotIndex(0, 3, 1)).toBe(1);
    expect(nextScreenshotIndex(2, 3, 1)).toBe(2);
    expect(nextScreenshotIndex(2, 3, -1)).toBe(1);
    expect(nextScreenshotIndex(0, 3, -1)).toBe(0);
    expect(nextScreenshotIndex(0, 0, 1)).toBe(0);
  });

  it("clamps the opening index to the available screenshots", () => {
    expect(clampScreenshotIndex(5, 3)).toBe(2);
    expect(clampScreenshotIndex(-1, 3)).toBe(0);
    expect(clampScreenshotIndex(1, 0)).toBe(0);
  });
});

describe("attempt screenshots", () => {
  it("uses the matching step description as the viewer caption", () => {
    expect(screenshotItems(attempt()).map(({ caption }) => caption)).toEqual([
      "Opened the cart",
      "Screenshot 2",
    ]);
  });
});
