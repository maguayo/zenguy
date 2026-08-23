import { describe, expect, it } from "vitest";

import type { Attempt } from "../api/types";
import { runnerLabel, screenshotItems, tokensLine } from "./AttemptDetail";

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

describe("attempt screenshots", () => {
  it("uses the matching step description as the viewer caption", () => {
    expect(screenshotItems(attempt()).map(({ caption }) => caption)).toEqual([
      "Opened the cart",
      "Screenshot 2",
    ]);
  });
});

describe("attempt execution line", () => {
  it("describes tokens with their breakdown, the model and the runner kind", () => {
    expect(
      tokensLine({
        inputTokens: 11_000,
        modelName: "gpt-5-mini",
        outputTokens: 1_345,
        runnerKind: "fallback",
        runnerVersion: "zenguy-fallback-runner/2.0.0",
        tokenUsage: 12_345,
      }),
    ).toBe("Tokens: 12,345 (11,000 in · 1,345 out) · Model: gpt-5-mini · Runner: Fallback");
  });

  it("shows only the total when the breakdown is unknown", () => {
    expect(
      tokensLine({
        inputTokens: null,
        modelName: "qwen/qwen3.8-27b",
        outputTokens: null,
        runnerKind: "primary",
        runnerVersion: "zenguy-local-runner/1.0.0",
        tokenUsage: 900,
      }),
    ).toBe("Tokens: 900 · Model: qwen/qwen3.8-27b · Runner: Primary");
  });

  it("falls back to dashes and the raw runner version", () => {
    expect(
      tokensLine({
        inputTokens: null,
        modelName: null,
        outputTokens: null,
        runnerKind: null,
        runnerVersion: null,
        tokenUsage: null,
      }),
    ).toBe("Tokens: — · Model: — · Runner: —");
    expect(runnerLabel({ runnerKind: null, runnerVersion: "zenguy-runner/1.0.0" })).toBe(
      "zenguy-runner/1.0.0",
    );
    expect(runnerLabel({ runnerKind: "primary", runnerVersion: null })).toBe("Primary");
  });
});
