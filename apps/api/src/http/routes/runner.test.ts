import { buildApp } from "../../app";
import type { ExternalRunnerJob } from "../../application/execution/external_runner";
import type { RunnerAttemptReference } from "../../domain/browser_tests/runner_protocol";
import type { AttemptMessage } from "../../domain/queues";
import { FixedClock } from "../../shared/clock";
import { fakeBindings } from "../../test/fakes/bindings";
import { FakeRunnerWorkerRepo } from "../../test/fakes/runners";

const TOKEN = "runner-test-secret".padEnd(32, "-");
const FALLBACK_TOKEN = "fallback-runner-test-secret".padEnd(32, "-");
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
    start: vi.fn(async () => ({
      startedAt: 2_000,
      deadlineAt: 302_000,
      secrets: [],
    })),
    authorizeAction: vi.fn(async () => true),
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

async function claimCapability(
  app: ReturnType<typeof buildApp>,
  workerId = "mac-1",
): Promise<string> {
  const response = await app.request("/api/runner/attempts/claim", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      deliveryId: REFERENCE.deliveryId,
      message: MESSAGE,
      workerId,
    }),
  });
  const body = (await response.json()) as {
    data: { job: { capability: string } };
  };
  return body.data.job.capability;
}

function capabilityHeaders(capability: string, workerId = "mac-1"): HeadersInit {
  return {
    ...headers(capability),
    "X-Zenguy-Worker-Id": workerId,
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
    await expect(response.json()).resolves.toMatchObject({
      data: {
        disposition: "EXECUTE",
        job: { ...JOB, capability: expect.any(String) },
      },
    });
    expect(externalRunner.claim).toHaveBeenCalledWith({
      deliveryId: "queue-message-1",
      message: MESSAGE,
      workerId: "mac-1",
    });
  });

  it("binds non-development bootstrap tokens to the configured runner identity", async () => {
    const externalRunner = runner();
    const bindings = fakeBindings();
    bindings.ENVIRONMENT = "production";
    const app = buildApp(bindings, { externalRunner });

    const wrong = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        deliveryId: "queue-message-1",
        message: MESSAGE,
        workerId: "stolen-token-alias",
      }),
    });
    expect(wrong.status).toBe(401);
    expect(externalRunner.claim).not.toHaveBeenCalled();

    const accepted = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        deliveryId: "queue-message-1",
        message: MESSAGE,
        workerId: "zenguy-production-primary",
      }),
    });
    expect(accepted.status).toBe(200);
    expect(externalRunner.claim).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "zenguy-production-primary" }),
    );
  });

  it("does not accept primary and fallback bootstrap tokens interchangeably", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const primaryWithFallback = await app.request(
      "/api/runner/attempts/claim",
      {
        method: "POST",
        headers: headers(FALLBACK_TOKEN),
        body: JSON.stringify({
          deliveryId: "queue-message-1",
          message: MESSAGE,
          workerId: "mac-1",
        }),
      },
    );
    const fallbackWithPrimary = await app.request(
      "/api/runner/attempts/claim-stale",
      {
        method: "POST",
        headers: headers(TOKEN),
        body: JSON.stringify({
          deliveryId: "fallback-1",
          workerId: "fallback-1",
        }),
      },
    );

    expect(primaryWithFallback.status).toBe(401);
    expect(fallbackWithPrimary.status).toBe(401);
    expect(externalRunner.claim).not.toHaveBeenCalled();
    expect(externalRunner.claimStale).not.toHaveBeenCalled();
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
      headers: headers(FALLBACK_TOKEN),
      body: JSON.stringify({ deliveryId: "fallback-1", workerId: "fallback-1" }),
    });
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get("Cache-Control")).toBe("no-store");
    await expect(claimed.json()).resolves.toMatchObject({
      data: {
        disposition: "EXECUTE",
        job: { ...JOB, capability: expect.any(String) },
      },
    });
    expect(externalRunner.claimStale).toHaveBeenCalledWith({
      deliveryId: "fallback-1",
      workerId: "fallback-1",
    });

    externalRunner.claimStale.mockResolvedValueOnce(null);
    const empty = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: headers(FALLBACK_TOKEN),
      body: JSON.stringify({ deliveryId: "fallback-2", workerId: "fallback-1" }),
    });
    await expect(empty.json()).resolves.toEqual({
      data: { disposition: "SKIP" },
    });

    const invalid = await app.request("/api/runner/attempts/claim-stale", {
      method: "POST",
      headers: headers(FALLBACK_TOKEN),
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);
  });

  it("validates route references and non-passing outcomes", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });

    const capability = await claimCapability(app);
    const mismatch = await app.request("/api/runner/attempts/another/start", {
      method: "POST",
      headers: capabilityHeaders(capability),
      body: JSON.stringify({ reference: REFERENCE }),
    });
    expect(mismatch.status).toBe(409);

    const invalidOutcome = await app.request(
      "/api/runner/attempts/att_1/complete",
      {
        method: "POST",
        headers: capabilityHeaders(capability),
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

  it("gates exact irreversible actions behind the job capability", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });
    const capability = await claimCapability(app);
    const action = {
      kind: "HTTP",
      method: "POST",
      origin: "https://staging.example.com",
      path: "/orders",
    };

    const accepted = await app.request(
      "/api/runner/attempts/att_1/actions/authorize",
      {
        method: "POST",
        headers: capabilityHeaders(capability),
        body: JSON.stringify({ reference: REFERENCE, action }),
      },
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({
      data: { disposition: "AUTHORIZED" },
    });
    expect(externalRunner.authorizeAction).toHaveBeenCalledWith({
      reference: REFERENCE,
      action,
    });

    externalRunner.authorizeAction.mockResolvedValueOnce(false);
    const blocked = await app.request(
      "/api/runner/attempts/att_1/actions/authorize",
      {
        method: "POST",
        headers: capabilityHeaders(capability),
        body: JSON.stringify({ reference: REFERENCE, action }),
      },
    );
    await expect(blocked.json()).resolves.toEqual({
      data: { disposition: "BLOCKED" },
    });
  });

  it("rejects legacy DOM action requests without the live form identity", async () => {
    const externalRunner = runner();
    const app = buildApp(fakeBindings(), { externalRunner });
    const capability = await claimCapability(app);
    const response = await app.request(
      "/api/runner/attempts/att_1/actions/authorize",
      {
        method: "POST",
        headers: capabilityHeaders(capability),
        body: JSON.stringify({
          reference: REFERENCE,
          action: {
            kind: "DOM",
            action: "CLICK",
            origin: "https://staging.example.com",
            path: "/checkout",
            target: { attribute: "data-testid", value: "place-order" },
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(externalRunner.authorizeAction).not.toHaveBeenCalled();
  });

  it("requires a job-scoped capability and binds it to the worker and reference", async () => {
    const externalRunner = runner();
    const clock = new FixedClock(10_000);
    const app = buildApp(fakeBindings(), { externalRunner, clock });
    const capability = await claimCapability(app, "mac-1");

    const bootstrapRejected = await app.request(
      "/api/runner/attempts/att_1/start",
      {
        method: "POST",
        headers: { ...headers(), "X-Zenguy-Worker-Id": "mac-1" },
        body: JSON.stringify({ reference: REFERENCE }),
      },
    );
    expect(bootstrapRejected.status).toBe(401);

    const wrongWorker = await app.request("/api/runner/attempts/att_1/start", {
      method: "POST",
      headers: capabilityHeaders(capability, "other-worker"),
      body: JSON.stringify({ reference: REFERENCE }),
    });
    expect(wrongWorker.status).toBe(401);

    const alteredReference = { ...REFERENCE, deliveryId: "other-delivery" };
    const replayed = await app.request("/api/runner/attempts/att_1/start", {
      method: "POST",
      headers: capabilityHeaders(capability),
      body: JSON.stringify({ reference: alteredReference }),
    });
    expect(replayed.status).toBe(401);

    const accepted = await app.request("/api/runner/attempts/att_1/start", {
      method: "POST",
      headers: capabilityHeaders(capability),
      body: JSON.stringify({ reference: REFERENCE }),
    });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({
      data: {
        disposition: "STARTED",
        startedAt: 2_000,
        deadlineAt: 302_000,
        secrets: [],
      },
    });

    clock.advance(6 * 60_000 + 1);
    const expired = await app.request("/api/runner/attempts/att_1/start", {
      method: "POST",
      headers: capabilityHeaders(capability),
      body: JSON.stringify({ reference: REFERENCE }),
    });
    expect(expired.status).toBe(401);
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

describe("cf runner identity", () => {
  const CF_TOKEN = "cf-runner-test-secret".padEnd(32, "-");

  function cfBindings() {
    const bindings = fakeBindings();
    bindings.RUNNER_CF_API_TOKEN = CF_TOKEN;
    return bindings;
  }

  it("acepta el token cf solo con la identidad zenguy-<env>-cf", async () => {
    const externalRunner = runner();
    const bindings = cfBindings();
    bindings.ENVIRONMENT = "production";
    const app = buildApp(bindings, { externalRunner });

    const accepted = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(CF_TOKEN),
      body: JSON.stringify({
        deliveryId: "cf-delivery-1",
        message: MESSAGE,
        workerId: "zenguy-production-cf",
      }),
    });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      data: {
        disposition: "EXECUTE",
        job: { ...JOB, capability: expect.any(String) },
      },
    });
    expect(externalRunner.claim).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "zenguy-production-cf" }),
    );
  });

  it("no acepta el token cf con otras identidades ni otros tokens con la cf", async () => {
    const externalRunner = runner();
    const bindings = cfBindings();
    bindings.ENVIRONMENT = "production";
    const app = buildApp(bindings, { externalRunner });

    const cfTokenPrimaryIdentity = await app.request(
      "/api/runner/attempts/claim",
      {
        method: "POST",
        headers: headers(CF_TOKEN),
        body: JSON.stringify({
          deliveryId: "cf-delivery-2",
          message: MESSAGE,
          workerId: "zenguy-production-primary",
        }),
      },
    );
    const primaryTokenCfIdentity = await app.request(
      "/api/runner/attempts/claim",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          deliveryId: "cf-delivery-3",
          message: MESSAGE,
          workerId: "zenguy-production-cf",
        }),
      },
    );
    const fallbackTokenOnClaim = await app.request(
      "/api/runner/attempts/claim",
      {
        method: "POST",
        headers: headers(FALLBACK_TOKEN),
        body: JSON.stringify({
          deliveryId: "cf-delivery-4",
          message: MESSAGE,
          workerId: "zenguy-production-cf",
        }),
      },
    );

    expect(cfTokenPrimaryIdentity.status).toBe(401);
    expect(primaryTokenCfIdentity.status).toBe(401);
    expect(fallbackTokenOnClaim.status).toBe(401);
    expect(externalRunner.claim).not.toHaveBeenCalled();
  });

  it("rechaza todo claim cf cuando el token no está configurado", async () => {
    const externalRunner = runner();
    const bindings = fakeBindings();
    delete bindings.RUNNER_CF_API_TOKEN;
    bindings.ENVIRONMENT = "production";
    const app = buildApp(bindings, { externalRunner });

    const withCfToken = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: headers(CF_TOKEN),
      body: JSON.stringify({
        deliveryId: "cf-delivery-5",
        message: MESSAGE,
        workerId: "zenguy-production-cf",
      }),
    });
    const withEmptyBearer = await app.request("/api/runner/attempts/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveryId: "cf-delivery-6",
        message: MESSAGE,
        workerId: "zenguy-production-cf",
      }),
    });

    expect(withCfToken.status).toBe(401);
    expect(withEmptyBearer.status).toBe(401);
    expect(externalRunner.claim).not.toHaveBeenCalled();
  });

  it("acepta heartbeats en modo cf solo con el token cf", async () => {
    const runnerWorkers = new FakeRunnerWorkerRepo();
    const clock = new FixedClock(50_000);
    const bindings = cfBindings();
    const app = buildApp(bindings, {
      externalRunner: runner(),
      runnerWorkers,
      clock,
    });
    const body = JSON.stringify({
      workerId: "cf-1",
      mode: "cf",
      version: "zenguy-cf-runner/2.2.0",
      startedAt: 40_000,
    });

    const accepted = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: headers(CF_TOKEN),
      body,
    });
    const wrongToken = await app.request("/api/runner/heartbeat", {
      method: "POST",
      headers: headers(FALLBACK_TOKEN),
      body,
    });

    expect(accepted.status).toBe(200);
    expect(wrongToken.status).toBe(401);
    expect(runnerWorkers.workers.get("cf-1")).toMatchObject({ mode: "cf" });
  });
});
