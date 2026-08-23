import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Attempt, AttemptSummary, Run } from "../api/types";
import { RunStatusPanel } from "./RunStatusPanel";

const EXPIRES_AT = "2026-08-24T00:00:00.000Z";

function shot(id: string) {
  return { expiresAt: EXPIRES_AT, id, url: `https://example.com/${id}.jpg` };
}

const SUMMARY: AttemptSummary = {
  attemptIndex: 0,
  durationMs: 64_000,
  failureReason: null,
  finishedAt: "2026-08-22T22:08:11.000Z",
  id: "att_1",
  inputTokens: 900,
  latestScreenshot: { id: "shot_3", url: "https://example.com/shot_3.jpg" },
  latestStep: { actionType: "done", description: "done", timestamp: "2026-08-22T22:08:10.000Z" },
  modelName: "gpt-5-mini",
  outputTokens: 100,
  queuedAt: "2026-08-22T21:54:53.000Z",
  retryDelaySeconds: 0,
  runnerKind: "fallback",
  runnerVersion: "zenguy-fallback-runner/2.0.0",
  startedAt: "2026-08-22T22:07:07.000Z",
  status: "PASSED",
  summary: "All good.",
  tokenUsage: 1_000,
};

const RUN: Run = {
  attemptCount: 1,
  attempts: [SUMMARY],
  billable: true,
  durationMs: 64_000,
  finishedAt: "2026-08-22T22:08:11.000Z",
  id: "run_1",
  incidentId: null,
  live: null,
  passedAfterRetry: false,
  queuedAt: "2026-08-22T21:54:53.000Z",
  scheduledFor: null,
  snapshot: {
    channelIds: [],
    device: "DESKTOP",
    instructions: "Add to cart",
    intervalHours: 24,
    maxRetries: 1,
    modelName: "qwen/qwen3.8-27b",
    name: "Añadir al carrito",
    notifyOnRecovery: true,
    runnerVersion: "zenguy-local-runner/1.0.0",
    startUrl: "https://cocunat.com",
    viewport: { height: 900, width: 1440 },
  },
  source: "MANUAL",
  startedAt: "2026-08-22T22:07:07.000Z",
  status: "PASSED",
  testId: "bt_1",
  triggeredBy: { name: "Marcos", userId: "usr_1" },
};

const ATTEMPT: Attempt = {
  ...SUMMARY,
  actualResult: null,
  consoleErrors: [],
  expectedResult: null,
  networkErrors: [],
  screenshots: [shot("shot_2"), shot("shot_3")],
  steps: [
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
      actionType: "done",
      description: "done",
      result: "OK",
      screenshot: shot("shot_3"),
      sequence: 3,
      timestamp: "2026-08-22T22:08:10.000Z",
      urlSanitized: "https://secure.cocunat.com/checkouts/cn/abc",
    },
  ],
  systemErrorCode: null,
  visitedUrls: [],
};

function render(ui: React.ReactElement): string {
  const client = new QueryClient();
  client.setQueryData(["ws", "ws_1", "runs", "run_1"], RUN);
  client.setQueryData(["ws", "ws_1", "attempts", "att_1"], ATTEMPT);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("RunStatusPanel screenshots", () => {
  it("shows every step screenshot of the latest attempt instead of one latest image", () => {
    const html = render(<RunStatusPanel runId="run_1" wsId="ws_1" />);

    expect(html).toContain('aria-label="Open step 2 screenshot"');
    expect(html).toContain('aria-label="Open step 3 screenshot"');
    expect(html).not.toContain("Latest validation screenshot");
  });

  it("keeps the single latest screenshot in compact mode", () => {
    const html = render(<RunStatusPanel compact runId="run_1" wsId="ws_1" />);

    expect(html).toContain('alt="Latest validation screenshot"');
    expect(html).not.toContain("Open step 2 screenshot");
  });
});
