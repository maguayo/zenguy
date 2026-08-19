import { describe, expect, it } from "vitest";

import type { Attempt } from "../api/types";
import { screenshotItems } from "./AttemptDetail";

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
    latestScreenshot: null,
    latestStep: null,
    modelName: "gpt-5-nano",
    networkErrors: [],
    queuedAt: "2026-08-19T10:00:00.000Z",
    retryDelaySeconds: 0,
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

describe("attempt screenshots", () => {
  it("uses the matching step description as the viewer caption", () => {
    expect(screenshotItems(attempt()).map(({ caption }) => caption)).toEqual([
      "Opened the cart",
      "Screenshot 2",
    ]);
  });
});
