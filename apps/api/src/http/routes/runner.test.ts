import { buildApp } from "../../app";
import type { ExternalRunnerJob } from "../../application/execution/external_runner";
import type { RunnerAttemptReference } from "../../domain/browser_tests/runner_protocol";
import type { AttemptMessage } from "../../domain/queues";
import { FixedClock } from "../../shared/clock";
import { fakeBindings } from "../../test/fakes/bindings";
import { FakeRunnerWorkerRepo } from "../../test/fakes/runners";

const TOKEN = "runner-test-secret".padEnd(32, "-");
const MESSAGE: AttemptMessage = {
  kind: "attempt",
  runId: "run_1",
  attemptId: "att_1",
  attemptIndex: 0,
  executionGeneration: 1_000,
};
const REFERENCE: RunnerAttemptReference = {
  runId: MESSAGE.runId,
  attemptId: MESSAGE.attemptId,
  attemptIndex: MESSAGE.attemptIndex,
  executionGeneration: MESSAGE.executionGeneration,
  deliveryId: "queue-message-1",
};

const JOB: ExternalRunnerJob = {
  reference: REFERENCE,
  snapshot: {
    name: "Checkout",
    startUrl: "https://example.com",
    instructions: "Verify the heading",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 1,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "qwen3:8b",
    runnerVersion: "zenguy-local-runner/1.0.0",
  },
  secrets: [],
  limits: {
    attemptTimeoutMs: 300_000,
    maxAgentSteps: 40,
    maxScreenshotsPerAttempt: 45,
    screenshotJpegQuality: 60,
  },
};

function runner() {
  return {
    claim: vi.fn(async () => JOB),
    claimStale: vi.fn(async (): Promise<ExternalRunnerJob | null> => JOB),
    start: vi.fn(async () => ({ startedAt: 2_000, deadlineAt: 302_000 })),
    recordStep: vi.fn(async () => true),
    complete: vi.fn(async () => true),
  };
}

function headers(token = TOKEN): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("external runner routes", () => {
  it("rejects missing or incorrect dedicated runner credentials", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const missing = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliveryId: "queue-message-1", message: MESSAGE }),
    });
    const incorrect = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers("wrong-token".padEnd(32, "-")),
      body: JSON.stringify({ deliveryId: "queue-message-1", message: MESSAGE }),
    });

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(externalRunner.claim).not.toHaveBeenCalled();
  });

  it("returns an executable job without allowing it to be cached", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const response = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        deliveryId: "queue-message-1",
        message: MESSAGE,
        workerId: "mac-1",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { disposition: "EXECUTE", job: JOB },
    });
    expect(externalRunner.claim).toHaveBeenCalledWith({
      deliveryId: "queue-message-1",
      message: MESSAGE,
      workerId: "mac-1",
    });
  });

  it("rejects claims from a malformed worker id", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const response = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        deliveryId: "queue-message-1",
        message: MESSAGE,
        workerId: "bad id!",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(externalRunner.claim).not.toHaveBeenCalled();
  });

  it("lets the fallback worker claim stale attempts without a queue message", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const unauthorized = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliveryId: "fallback-1" }),
    });
    expect(unauthorized.status).toBe(401);

    const claimed = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ deliveryId: "fallback-1" }),
    });
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("Cache-Control")).toBe("no-store");
    await expect(claimed.json()).resolves.toEqual({
      data: { disposition: "EXECUTE", job: JOB },
    });
    expect(externalRunner.claimStale).toHaveBeenCalledWith({
      deliveryId: "fallback-1",
    });

    externalRunner.claimStale.mockResolvedValueOnce(null);
    const empty = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ deliveryId: "fallback-2" }),
    });
    await expect(empty.json()).resolves.toEqual({
      data: { disposition: "SKIP" },
    });

    const invalid = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
  });

  it("validates route references and non-passing outcomes", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const mismatch = await app.request("/api/runner/attempts/another/start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ reference: REFERENCE }),
    });
    expect(mismatch.status).toBe(409);

    const invalidOutcome = await app.request(
      "/api/runner/attempts/att_1/complete",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          reference: REFERENCE,
          outcome: {
            status: "FAILED",
            modelName: "qwen3:8b",
            runnerVersion: "local/1",
            visitedUrls: [],
            consoleErrors: [],
            networkErrors: [],
          },
        }),
      },
    );
    expect(invalidOutcome.status).toBe(400);
    expect(externalRunner.start).not.toHaveBeenCalled();
    expect(externalRunner.complete).not.toHaveBeenCalled();
  });
});

describe("runner heartbeat", () => {
  it("rejects heartbeats without the runner token", async () => {
    const runnerWorkers = new FakeRunnerWorkerRepo();
    const app = buildApp(fakeBindings(), {
      externalRunner: runner(),
      runnerWorkers,
    });

    const response = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "mac-1",
        mode: "local",
        version: "zenguy-local-runner/2.0.0",
        startedAt: 1,
      }),
    });

    expect(response.status).toBe(401);
    expect(runnerWorkers.workers.size).toBe(0);
  });

  it("upserts the worker with the server clock", async () => {
    const runnerWorkers = new FakeRunnerWorkerRepo();
    const clock = new FixedClock(50_000);
    const app = buildApp(fakeBindings(), {
      externalRunner: runner(),
      runnerWorkers,
      clock,
    });
    const body = JSON.stringify({
      workerId: "mac-1",
      mode: "local",
      version: "zenguy-local-runner/2.0.0",
      startedAt: 40_000,
    });

    const first = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: headers(),
      body,
    });
    clock.advance(5_000);
    const second = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: headers(),
      body,
    });

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    await expect(second.json()).resolves.toEqual({ data: { ok: true } });
    expect(runnerWorkers.workers.get("mac-1")).toEqual({
      id: "mac-1",
      mode: "local",
      version: "zenguy-local-runner/2.0.0",
      startedAt: 40_000,
      firstSeenAt: 50_000,
      lastSeenAt: 55_000,
    });
  });

  it("validates the heartbeat payload", async () => {
    const runnerWorkers = new FakeRunnerWorkerRepo();
    const app = buildApp(fakeBindings(), {
      externalRunner: runner(),
      runnerWorkers,
    });

    const response = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        workerId: "bad id!",
        mode: "queue",
        version: "",
        startedAt: -1,
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(runnerWorkers.workers.size).toBe(0);
  });
});
