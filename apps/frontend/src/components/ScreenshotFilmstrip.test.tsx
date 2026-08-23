import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Attempt } from "../api/types";
import { filmstripItems, ScreenshotFilmstrip } from "./ScreenshotFilmstrip";

const EXPIRES_AT = "2026-08-24T00:00:00.000Z";

function shot(id: string) {
  return { expiresAt: EXPIRES_AT, id, url: `https://example.com/${id}.jpg` };
}

function attempt(): Attempt {
  return {
    actualResult: null,
    attemptIndex: 0,
    consoleErrors: [],
    durationMs: 64_000,
    expectedResult: null,
    failureReason: null,
    finishedAt: "2026-08-22T22:08:11.000Z",
    id: "att_1",
    inputTokens: null,
    latestScreenshot: shot("shot_3"),
    latestStep: null,
    modelName: "gpt-5-mini",
    networkErrors: [],
    outputTokens: null,
    queuedAt: "2026-08-22T21:54:53.000Z",
    retryDelaySeconds: 0,
    runnerKind: "fallback",
    runnerVersion: "zenguy-fallback-runner/2.0.0",
    screenshots: [shot("shot_2"), shot("shot_3"), shot("shot_orphan")],
    startedAt: "2026-08-22T22:07:07.000Z",
    status: "PASSED",
    steps: [
      {
        actionType: "navigate",
        description: 'navigate {"url":"https://cocunat.com"}',
        result: "OK",
        screenshot: null,
        sequence: 1,
        timestamp: "2026-08-22T22:07:08.000Z",
        urlSanitized: null,
      },
      {
        actionType: "click",
        description: 'click {"index":20962}',
        result: "OK",
        screenshot: shot("shot_2"),
        sequence: 2,
        timestamp: "2026-08-22T22:07:24.000Z",
        urlSanitized: "https://cocunat.com/de-de/",
      },
      {
        actionType: "wait",
        description: 'wait {"seconds":3}',
        result: "OK",
        screenshot: shot("shot_3"),
        sequence: 3,
        timestamp: "2026-08-22T22:07:59.000Z",
        urlSanitized: "https://secure.cocunat.com/checkouts/cn/abc",
      },
    ],
    summary: "All good.",
    systemErrorCode: null,
    tokenUsage: 1_000,
    visitedUrls: [],
  };
}

describe("screenshot filmstrip", () => {
  it("lists every screenshot in order, labelled with its step and action", () => {
    expect(
      filmstripItems(attempt()).map(({ caption, id, label, sequence }) => [
        id,
        sequence,
        label,
        caption,
      ]),
    ).toEqual([
      ["shot_2", 2, "Step 2 · click", 'click {"index":20962}'],
      ["shot_3", 3, "Step 3 · wait", 'wait {"seconds":3}'],
      ["shot_orphan", null, "Screenshot 3", "Screenshot 3"],
    ]);
  });

  it("renders one thumbnail button per screenshot", () => {
    const html = renderToStaticMarkup(
      <ScreenshotFilmstrip items={filmstripItems(attempt())} onOpen={() => undefined} />,
    );

    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Open step 2 screenshot"');
    expect(html).toContain('aria-label="Open screenshot 3"');
    expect(html).toContain("Step 2 · click");
    expect(html).toContain('src="https://example.com/shot_3.jpg"');
  });

  it("renders nothing without screenshots", () => {
    expect(
      renderToStaticMarkup(<ScreenshotFilmstrip items={[]} onOpen={() => undefined} />),
    ).toBe("");
  });
});
