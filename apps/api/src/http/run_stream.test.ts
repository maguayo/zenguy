import { GetRun } from "../application/browser_tests/get_run";
import type {
  TestAttempt,
  TestRun,
} from "../domain/browser_tests/types";
import { FixedClock } from "../shared/clock";
import {
  FakeAttemptRepo,
  FakeRunRepo,
} from "../test/fakes/browser_test_repos";
import { FakeUserRepo } from "../test/fakes/repos";
import { streamRunUpdates } from "./run_stream";
import type { SseFrame } from "./sse";

const NOW = 1_700_000_000_000;
const CONFIG = { artifactUrlSecret: "sse-test-secret".padEnd(32, "-") };
const RUN: TestRun = {
  id: "run_sse",
  workspaceId: "ws_sse",
  browserTestId: null,
  source: "VALIDATION",
  status: "RUNNING",
  snapshot: {
    name: "Live test",
    startUrl: "https://example.com",
    instructions: "Check the page",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: false,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "zenguy-runner/1.0.0",
  },
  scheduledFor: null,
  queuedAt: NOW - 1_000,
  startedAt: NOW,
  finishedAt: null,
  durationMs: null,
  attemptCount: 0,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: null,
  triggeredByUserId: null,
  incidentId: null,
  createdAt: NOW - 1_000,
};

async function fixture() {
  const runs = new FakeRunRepo();
  const attempts = new FakeAttemptRepo();
  const users = new FakeUserRepo();
  const clock = new FixedClock(NOW);
  await runs.insert(RUN);
  const getRun = new GetRun(runs, attempts, users, CONFIG, clock);
  return { runs, clock, getRun };
}

describe("streamRunUpdates", () => {
  it("emits the initial update, dedupes unchanged state, pings, and ends terminal runs", async () => {
    const { runs, clock, getRun } = await fixture();
    let sleeps = 0;
    const frames: SseFrame[] = [];
    for await (const frame of streamRunUpdates(
      { workspaceId: RUN.workspaceId, runId: RUN.id },
      {
        getRun,
        clock,
        sleep: async (milliseconds) => {
          clock.advance(milliseconds);
          sleeps += 1;
          if (sleeps === 9) {
            await runs.finalize(RUN.id, {
              status: "PASSED",
              finishedAt: clock.now(),
              durationMs: clock.now() - RUN.queuedAt,
              attemptCount: 1,
              passedAfterRetry: false,
              billable: true,
            });
          }
        },
      },
    )) {
      frames.push(frame);
    }

    const updates = frames.filter(
      (frame): frame is Extract<SseFrame, { event: string }> =>
        "event" in frame && frame.event === "update",
    );
    expect(updates).toHaveLength(2);
    expect(JSON.parse(updates[0]?.data ?? "{}")).toMatchObject({
      id: RUN.id,
      status: "RUNNING",
    });
    expect(JSON.parse(updates[1]?.data ?? "{}")).toMatchObject({
      id: RUN.id,
      status: "PASSED",
      live: null,
    });
    expect(frames).toContainEqual({ comment: "ping" });
    expect(frames.at(-1)).toEqual({ event: "done", data: "{}" });
    expect(sleeps).toBe(9);
  });

  it("closes at the fifteen-minute hard cap without a done event", async () => {
    const { clock, getRun } = await fixture();
    const frames: SseFrame[] = [];
    for await (const frame of streamRunUpdates(
      { workspaceId: RUN.workspaceId, runId: RUN.id },
      {
        getRun,
        clock,
        sleep: async () => clock.advance(15 * 60_000),
      },
    )) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: "update" });
  });

  it("redacts referenced secret values from every SSE update frame", async () => {
    const rawSecret = "sse-raw-secret-value";
    const securedRun: TestRun = {
      ...structuredClone(RUN),
      snapshot: {
        ...structuredClone(RUN.snapshot),
        instructions: "Authenticate with {{API_TOKEN}}",
      },
    };
    const attempt: TestAttempt = {
      id: "att_sse_redaction",
      testRunId: securedRun.id,
      attemptIndex: 0,
      status: "RUNNING",
      retryDelaySeconds: 0,
      queuedAt: NOW,
      startedAt: NOW,
      finishedAt: null,
      durationMs: null,
      summary: `Using ${rawSecret}`,
      expectedResult: null,
      actualResult: null,
      failureReason: `Rejected ${rawSecret}`,
      visitedUrlsJson: "[]",
      consoleErrorsJson: "[]",
      networkErrorsJson: "[]",
      tokenUsage: null,
      inputTokens: null,
      outputTokens: null,
      modelName: "gpt-5-mini",
      runnerVersion: "test",
      runnerKind: null,
      systemErrorCode: null,
      createdAt: NOW,
    };
    const runs = new FakeRunRepo();
    const attempts = new FakeAttemptRepo();
    const clock = new FixedClock(NOW);
    await runs.insert(securedRun);
    await attempts.insert(attempt);
    const getRun = new GetRun(
      runs,
      attempts,
      new FakeUserRepo(),
      CONFIG,
      clock,
      {
        execute: async () =>
          new Map([
            [
              "API_TOKEN",
              { value: rawSecret, allowedDomains: ["example.com"] },
            ],
          ]),
      },
    );
    const stream = streamRunUpdates(
      { workspaceId: securedRun.workspaceId, runId: securedRun.id },
      { getRun, clock },
    );

    const first = await stream.next();
    await stream.return(undefined);

    expect(first.value).toMatchObject({ event: "update" });
    const serialized = "data" in (first.value ?? {})
      ? (first.value as { data: string }).data
      : "";
    expect(serialized).toContain("{{API_TOKEN}}");
    expect(serialized).not.toContain(rawSecret);
  });
});
