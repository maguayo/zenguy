import { RecordRunUsage } from "../billing/record_run_usage";
import { ReverseRunUsage } from "../billing/reverse_run_usage";
import type { RunFinalizedHandler } from "../../domain/browser_tests/ports";
import type { AgentAction, LlmClient } from "../../domain/browser_tests/agent_types";
import type {
  BrowserTest,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { AttemptMessage } from "../../domain/queues";
import type { Workspace } from "../../domain/workspaces/types";
import type { PageState } from "../../infrastructure/browser/types";
import {
  ActionError,
  type BrowserSession,
  type CollectedBrowserEvidence,
} from "../../infrastructure/browser/session";
import { LlmUnavailableError } from "../../infrastructure/llm/openai";
import { FixedClock } from "../../shared/clock";
import { RUNNER_VERSION } from "../../shared/constants";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeArtifactRepo,
  FakeAttemptRepo,
  FakeBrowserTestRepo,
  FakeRunRepo,
  FakeStepRepo,
} from "../../test/fakes/browser_test_repos";
import {
  FakeUsageEventRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import { AttemptLifecycle } from "./attempt_lifecycle";
import { ExecuteAttempt } from "./execute_attempt";

const NOW = 1_800_000_000_000;
const WORKSPACE: Workspace = {
  id: "ws_execute",
  name: "Execute",
  slug: "execute",
  timezone: "UTC",
  ownerUserId: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const TEST: BrowserTest = {
  id: "bt_execute",
  workspaceId: WORKSPACE.id,
  name: "Checkout",
  startUrl: "https://shop.example.com/start",
  instructions: "Use {{SHOP_TOKEN}} and verify checkout.",
  device: "DESKTOP",
  intervalHours: 24,
  maxRetries: 0,
  notifyOnRecovery: true,
  nextRunAt: NOW + 86_400_000,
  createdBy: "usr_owner",
  updatedBy: "usr_owner",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const RUN: TestRun = {
  id: "run_execute",
  workspaceId: WORKSPACE.id,
  browserTestId: TEST.id,
  source: "MANUAL",
  status: "QUEUED",
  snapshot: {
    name: TEST.name,
    startUrl: TEST.startUrl,
    instructions: TEST.instructions,
    device: TEST.device,
    intervalHours: TEST.intervalHours,
    maxRetries: TEST.maxRetries,
    notifyOnRecovery: TEST.notifyOnRecovery,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: RUNNER_VERSION,
  },
  scheduledFor: null,
  queuedAt: NOW,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  attemptCount: 0,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: null,
  triggeredByUserId: "usr_owner",
  incidentId: null,
  createdAt: NOW,
};
const ATTEMPT: TestAttempt = {
  id: "att_execute",
  testRunId: RUN.id,
  attemptIndex: 0,
  status: "QUEUED",
  retryDelaySeconds: 0,
  queuedAt: NOW,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  summary: null,
  expectedResult: null,
  actualResult: null,
  failureReason: null,
  visitedUrlsJson: null,
  consoleErrorsJson: null,
  networkErrorsJson: null,
  tokenUsage: null,
  modelName: null,
  runnerVersion: null,
  systemErrorCode: null,
  createdAt: NOW,
};
const MESSAGE: AttemptMessage = {
  kind: "attempt",
  runId: RUN.id,
  attemptId: ATTEMPT.id,
  attemptIndex: 0,
};

class RecordingQueue implements Pick<Queue<AttemptMessage>, "send"> {
  readonly calls: Array<{ message: AttemptMessage; delaySeconds: number }> = [];

  async send(
    message: AttemptMessage,
    options?: QueueSendOptions,
  ): Promise<QueueSendResponse> {
    this.calls.push({
      message: structuredClone(message),
      delaySeconds: options?.delaySeconds ?? 0,
    });
    return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
  }
}

class RecordingStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();
  readonly deleted: string[][] = [];

  async put(
    key: string,
    bytes: Uint8Array | ArrayBuffer,
    contentType: string,
  ): Promise<{ sizeBytes: number }> {
    const copy =
      bytes instanceof Uint8Array
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes.slice(0));
    this.objects.set(key, { bytes: copy, contentType });
    return { sizeBytes: copy.byteLength };
  }

  async delete(keys: string[]): Promise<void> {
    this.deleted.push([...keys]);
    for (const key of keys) this.objects.delete(key);
  }
}

class RecordingFinalizedHandler implements RunFinalizedHandler {
  readonly runs: TestRun[] = [];

  async handle(run: TestRun): Promise<void> {
    this.runs.push(structuredClone(run));
  }
}

class StaticSecretResolver {
  readonly calls: Array<{ workspaceId: string; referencedKeys: string[] }> = [];

  constructor(private readonly secrets: ResolvedSecrets) {}

  async execute(input: {
    workspaceId: string;
    referencedKeys: string[];
  }): Promise<ResolvedSecrets> {
    this.calls.push(structuredClone(input));
    return new Map(
      [...this.secrets].map(([key, secret]) => [
        key,
        { value: secret.value, allowedDomains: [...secret.allowedDomains] },
      ]),
    );
  }
}

class FakeSession implements BrowserSession {
  current = "about:blank";
  screenshotCalls = 0;
  disposeCalls = 0;
  navigateError: unknown = null;
  serializeError: unknown = null;
  readonly navigations: string[] = [];
  readonly clicks: number[] = [];

  async navigate(url: string): Promise<void> {
    if (this.navigateError !== null) throw this.navigateError;
    this.navigations.push(url);
    this.current = url;
  }

  currentUrl(): string {
    return this.current;
  }

  title(): Promise<string> {
    return Promise.resolve("Shop");
  }

  serialize(): Promise<PageState> {
    if (this.serializeError !== null) return Promise.reject(this.serializeError);
    return Promise.resolve({
      url: this.current,
      title: "Shop",
      scrollY: 0,
      scrollHeight: 900,
      innerHeight: 900,
      elements: [
        {
          i: 2,
          tag: "button",
          type: null,
          text: "Continue",
          aria: null,
          href: null,
          inViewport: true,
        },
      ],
      textDigest: "Checkout ready",
    });
  }

  async click(index: number): Promise<void> {
    this.clicks.push(index);
  }

  async type(): Promise<void> {}

  async select(): Promise<void> {}

  async pressKey(): Promise<void> {}

  async scroll(): Promise<void> {}

  async goBack(): Promise<void> {}

  screenshotJpeg(): Promise<Uint8Array> {
    this.screenshotCalls += 1;
    return Promise.resolve(new Uint8Array([0xff, this.screenshotCalls]));
  }

  collected(): CollectedBrowserEvidence {
    return {
      visitedUrls: [
        "https://shop.example.com/start?token=top-secret-value",
      ],
      consoleErrors: [
        {
          level: "error",
          message: "Leaked top-secret-value",
          url: "https://shop.example.com/app.js",
          timestamp: "2027-01-15T08:00:00.000Z",
        },
      ],
      networkErrors: [
        {
          method: "GET",
          host: "shop.example.com",
          path: "/api",
          statusCode: null,
          errorType: "top-secret-value rejected",
          durationMs: null,
        },
      ],
    };
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}

class ScriptedLlm implements LlmClient {
  readonly inputs: Parameters<LlmClient["decideAction"]>[0][] = [];

  constructor(private readonly actions: AgentAction[]) {}

  decideAction(
    input: Parameters<LlmClient["decideAction"]>[0],
  ): Promise<{ action: AgentAction; tokensUsed: number }> {
    this.inputs.push(structuredClone(input));
    const action = this.actions.shift();
    if (action === undefined) throw new Error("No scripted action");
    return Promise.resolve({ action, tokensUsed: 6 });
  }
}

class UnavailableLlm implements LlmClient {
  decideAction(): Promise<never> {
    return Promise.reject(new LlmUnavailableError());
  }
}

class HangingLlm implements LlmClient {
  decideAction(): Promise<never> {
    return new Promise(() => undefined);
  }
}

function action(
  fields: Partial<AgentAction> & Pick<AgentAction, "action">,
): AgentAction {
  return { thought: "Continue.", ...fields };
}

function finish(): AgentAction {
  return action({
    action: "finish",
    outcome: "PASSED",
    summary: "Checkout passed.",
    expected_result: "Checkout is available.",
    actual_result: "Checkout was available.",
  });
}

async function fixture(options: {
  run?: Partial<TestRun>;
  secrets?: ResolvedSecrets;
  session?: FakeSession;
  llm?: LlmClient;
  launchFailure?: Error;
  waitForHardTimeout?: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
} = {}) {
  const clock = new FixedClock(NOW);
  const ids = new FakeIds();
  const runs = new FakeRunRepo();
  const attempts = new FakeAttemptRepo(runs);
  const steps = new FakeStepRepo();
  const artifacts = new FakeArtifactRepo();
  const tests = new FakeBrowserTestRepo();
  const workspaces = new FakeWorkspaceRepo();
  const usageEvents = new FakeUsageEventRepo();
  const queue = new RecordingQueue();
  const storage = new RecordingStorage();
  const finalized = new RecordingFinalizedHandler();
  const resolver = new StaticSecretResolver(options.secrets ?? new Map());
  const recordUsage = new RecordRunUsage(usageEvents, clock, ids);
  const reverseUsage = new ReverseRunUsage(usageEvents, clock);
  const session = options.session ?? new FakeSession();
  const llm =
    options.llm ??
    new ScriptedLlm([
      action({ action: "click", index: 2 }),
      finish(),
    ]);
  const run: TestRun = {
    ...RUN,
    ...options.run,
    snapshot: {
      ...RUN.snapshot,
      ...(options.run?.snapshot ?? {}),
    },
  };
  await workspaces.insert(WORKSPACE);
  await tests.insert(TEST);
  await runs.insert(run);
  await attempts.insert(ATTEMPT);
  const lifecycle = new AttemptLifecycle({
    runs,
    attempts,
    steps,
    artifacts,
    tests,
    workspaces,
    storage,
    recordUsage,
    reverseUsage,
    queue,
    clock,
    ids,
    runFinalizedHandler: finalized,
  });
  const launchSession = vi.fn(async () => {
    if (options.launchFailure !== undefined) throw options.launchFailure;
    return session;
  });
  const executor = new ExecuteAttempt({
    lifecycle,
    runs,
    attempts,
    steps,
    artifacts,
    storage,
    resolveSecrets: resolver,
    launchSession,
    llm,
    llmUseVision: false,
    clock,
    ids,
    ...(options.waitForHardTimeout === undefined
      ? {}
      : {
          waitForHardTimeout: options.waitForHardTimeout,
        }),
  });
  return {
    executor,
    clock,
    ids,
    runs,
    attempts,
    steps,
    artifacts,
    usageEvents,
    recordUsage,
    queue,
    storage,
    finalized,
    resolver,
    session,
    llm,
    launchSession,
  };
}

describe("ExecuteAttempt", () => {
  it("persists a complete happy path with live steps, R2 screenshots, and redacted evidence", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secretValue = "top-secret-value";
    const value = await fixture({
      secrets: new Map([
        [
          "SHOP_TOKEN",
          { value: secretValue, allowedDomains: ["shop.example.com"] },
        ],
      ]),
    });

    await value.executor.execute(MESSAGE);

    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "PASSED",
      attemptCount: 1,
      billable: true,
      usageEventId: expect.any(String),
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "PASSED",
      summary: "Checkout passed.",
      expectedResult: "Checkout is available.",
      actualResult: "Checkout was available.",
      tokenUsage: 12,
      modelName: RUN.snapshot.modelName,
      runnerVersion: RUNNER_VERSION,
      systemErrorCode: null,
    });
    const savedAttempt = await value.attempts.findById(ATTEMPT.id);
    expect(savedAttempt?.visitedUrlsJson).toContain("{{SHOP_TOKEN}}");
    expect(savedAttempt?.consoleErrorsJson).toContain("{{SHOP_TOKEN}}");
    expect(savedAttempt?.networkErrorsJson).toContain("{{SHOP_TOKEN}}");
    expect(JSON.stringify(savedAttempt)).not.toContain(secretValue);

    const steps = await value.steps.listForAttempt(ATTEMPT.id);
    const artifacts = await value.artifacts.listForAttempt(ATTEMPT.id);
    expect(steps.map(({ sequence, actionType, result }) => ({
      sequence,
      actionType,
      result,
    }))).toEqual([
      { sequence: 1, actionType: "navigate", result: "OK" },
      { sequence: 2, actionType: "click", result: "OK" },
      { sequence: 3, actionType: "finish", result: "OK" },
    ]);
    expect(steps.every((step) => step.artifactId !== null)).toBe(true);
    expect(artifacts).toHaveLength(3);
    expect(value.storage.objects.size).toBe(3);
    expect(
      artifacts.every(
        (artifact) =>
          artifact.mimeType === "image/jpeg" &&
          artifact.storageKey.startsWith(
            `ws/${WORKSPACE.id}/run/${RUN.id}/att/${ATTEMPT.id}/`,
          ) &&
          artifact.expiresAt === NOW + 30 * 86_400_000,
      ),
    ).toBe(true);
    expect(value.session.navigations).toEqual([TEST.startUrl]);
    expect(value.session.clicks).toEqual([2]);
    expect(value.session.disposeCalls).toBe(1);
    expect(value.usageEvents.events.size).toBe(1);
    expect(value.finalized.runs).toHaveLength(1);
    expect(value.resolver.calls).toEqual([
      { workspaceId: WORKSPACE.id, referencedKeys: ["SHOP_TOKEN"] },
    ]);
    expect(log.mock.calls.join(" ")).toContain('"event":"attempt_tokens"');
    expect(log.mock.calls.join(" ")).toContain('"tokens":12');
    log.mockRestore();
  });

  it("continues the agent loop after an initial navigation action error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const session = new FakeSession();
    session.navigateError = new ActionError("Navigation timed out");
    const value = await fixture({ session });

    await value.executor.execute(MESSAGE);

    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "PASSED",
    });
    const steps = await value.steps.listForAttempt(ATTEMPT.id);
    expect(steps[0]).toMatchObject({
      sequence: 1,
      actionType: "navigate",
      result: "ERROR",
    });
    expect(steps[0]?.description).toContain("Navigation timed out");
    expect(steps[1]).toMatchObject({ sequence: 2, result: "OK" });
    log.mockRestore();
  });

  it("substitutes an allowed start-URL secret without persisting its value", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secretValue = "top-secret-value";
    const value = await fixture({
      run: {
        snapshot: {
          ...RUN.snapshot,
          startUrl:
            "https://shop.example.com/start?access={{SHOP_TOKEN}}",
        },
      },
      secrets: new Map([
        [
          "SHOP_TOKEN",
          { value: secretValue, allowedDomains: ["shop.example.com"] },
        ],
      ]),
    });

    await value.executor.execute(MESSAGE);

    expect(value.session.navigations).toEqual([
      `https://shop.example.com/start?access=${secretValue}`,
    ]);
    const steps = await value.steps.listForAttempt(ATTEMPT.id);
    expect(steps[0]).toMatchObject({
      sequence: 1,
      result: "OK",
    });
    expect(JSON.stringify(steps)).toContain("{{SHOP_TOKEN}}");
    expect(JSON.stringify(steps)).not.toContain(secretValue);
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.not.toBeNull();
    expect(
      JSON.stringify(await value.attempts.findById(ATTEMPT.id)),
    ).not.toContain(secretValue);
    log.mockRestore();
  });

  it("records a blocked initial URL as an error the agent can recover from", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const llm = new ScriptedLlm([finish()]);
    const value = await fixture({
      run: {
        snapshot: {
          ...RUN.snapshot,
          startUrl: "http://127.0.0.1/private",
        },
      },
      llm,
    });

    await value.executor.execute(MESSAGE);

    expect(value.session.navigations).toEqual([]);
    const steps = await value.steps.listForAttempt(ATTEMPT.id);
    expect(steps[0]).toMatchObject({
      sequence: 1,
      result: "ERROR",
    });
    expect(steps[0]?.description).toContain(
      "Navigation blocked: URL not allowed",
    );
    expect(llm.inputs[0]?.userText).toContain(
      "1. navigate → ERROR: Initial navigation",
    );
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "PASSED",
    });
    log.mockRestore();
  });

  it("sanitizes sensitive query values in initial-navigation evidence", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const value = await fixture({
      run: {
        snapshot: {
          ...RUN.snapshot,
          startUrl:
            "https://shop.example.com/start?token=literal-sensitive&view=full",
        },
      },
    });

    await value.executor.execute(MESSAGE);

    const steps = await value.steps.listForAttempt(ATTEMPT.id);
    expect(steps[0]?.description).toContain("token=redacted");
    expect(steps[0]?.description).toContain("view=full");
    expect(steps[0]?.urlSanitized).toContain("token=redacted");
    expect(JSON.stringify(steps)).not.toContain("literal-sensitive");
    log.mockRestore();
  });

  it("runs the same attempt through two launch retries, then reverses pre-start usage", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const value = await fixture({ launchFailure: new Error("browser unavailable") });
    const usageEventId = await value.recordUsage.execute({
      workspaceId: WORKSPACE.id,
      runId: RUN.id,
      occurredAt: NOW,
    });
    await value.runs.setUsageEventId(RUN.id, usageEventId);

    await value.executor.execute(MESSAGE);
    const retryOne = value.queue.calls[0]?.message;
    if (retryOne === undefined) throw new Error("first infra retry missing");
    value.clock.advance(30_000);
    await value.executor.execute(retryOne);
    const retryTwo = value.queue.calls[1]?.message;
    if (retryTwo === undefined) throw new Error("second infra retry missing");
    value.clock.advance(30_000);
    await value.executor.execute(retryTwo);

    expect(value.launchSession).toHaveBeenCalledTimes(3);
    expect(value.queue.calls).toEqual([
      { message: MESSAGE, delaySeconds: 30 },
      { message: MESSAGE, delaySeconds: 30 },
    ]);
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      startedAt: null,
      infraAttempts: 2,
      attemptCount: 1,
      billable: false,
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      id: ATTEMPT.id,
      attemptIndex: 0,
      status: "SYSTEM_ERROR",
      systemErrorCode: "BROWSER_LAUNCH_FAILED",
      tokenUsage: 0,
      modelName: RUN.snapshot.modelName,
      runnerVersion: RUNNER_VERSION,
    });
    expect(value.usageEvents.events.get(usageEventId)?.reversedAt).toBe(
      NOW + 60_000,
    );
    expect(value.steps.steps.size).toBe(0);
    expect(value.artifacts.artifacts.size).toBe(0);
    expect(value.finalized.runs).toHaveLength(1);
    expect(alert.mock.calls.join(" ")).toContain(
      '"event":"browser_launch_failed"',
    );
    alert.mockRestore();
    log.mockRestore();
  });

  it("hard-disposes a hung agent after the grace timer and preserves a TIMEOUT", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const waitForHardTimeout = vi.fn(
      async (_milliseconds: number, _signal: AbortSignal) => undefined,
    );
    const value = await fixture({
      llm: new HangingLlm(),
      waitForHardTimeout,
    });

    await value.executor.execute(MESSAGE);

    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "TIMEOUT",
      billable: true,
    });
    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "TIMEOUT",
      failureReason: "Attempt timed out after 5 minutes",
      tokenUsage: 0,
    });
    expect(value.session.disposeCalls).toBeGreaterThanOrEqual(2);
    expect(await value.steps.listForAttempt(ATTEMPT.id)).toHaveLength(1);
    expect(await value.artifacts.listForAttempt(ATTEMPT.id)).toHaveLength(1);
    expect(waitForHardTimeout).toHaveBeenCalledOnce();
    expect(waitForHardTimeout.mock.calls[0]?.[0]).toBe(310_000);
    expect(waitForHardTimeout.mock.calls[0]?.[1].aborted).toBe(true);
    log.mockRestore();
  });

  it("classifies provider outages separately and never opens a customer path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const value = await fixture({
      run: { infraAttempts: 2 },
      llm: new UnavailableLlm(),
    });

    await value.executor.execute(MESSAGE);

    await expect(value.attempts.findById(ATTEMPT.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      systemErrorCode: "LLM_UNAVAILABLE",
    });
    await expect(value.runs.findByIdForExecution(RUN.id)).resolves.toMatchObject({
      status: "SYSTEM_ERROR",
      billable: true,
    });
    expect(value.finalized.runs).toHaveLength(1);
    expect(alert.mock.calls.join(" ")).toContain('"event":"llm_unavailable"');
    alert.mockRestore();
    log.mockRestore();
  });
});
