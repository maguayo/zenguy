import type { Hono } from "hono";
import { buildApp } from "../../app";
import type {
  BrowserTest,
  RunArtifact,
  RunSnapshot,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1BrowserTestRepo } from "../../infrastructure/db/browser_test_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1StepRepo } from "../../infrastructure/db/step_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import {
  ArtifactStorage,
  artifactStorageKey,
} from "../../infrastructure/storage/artifacts";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import {
  ARTIFACT_SIG_TTL_SECONDS,
  RATE_LIMITS,
} from "../../shared/constants";
import { hmacSign } from "../../shared/crypto";
import { signArtifactUrl } from "../artifact_sign";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import type { AppEnv } from "../env";

const NOW = Date.now();
const USER: User = {
  id: "usr_run_reader",
  name: "Run Reader",
  email: "reader@runs.test",
  passwordHash: "hash",
  emailVerifiedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_run_read",
  name: "Run Read Workspace",
  slug: "run-read-workspace",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const OTHER_WORKSPACE: Workspace = {
  ...WORKSPACE,
  id: "ws_run_other",
  name: "Other Workspace",
  slug: "run-other-workspace",
};
const TEST: BrowserTest = {
  id: "bt_run_read",
  workspaceId: WORKSPACE.id,
  name: "Checkout",
  startUrl: "https://example.com/checkout",
  instructions: "Complete checkout",
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  nextRunAt: NOW + 21_600_000,
  createdBy: USER.id,
  updatedBy: USER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const SNAPSHOT: RunSnapshot = {
  name: TEST.name,
  startUrl: TEST.startUrl,
  instructions: TEST.instructions,
  device: "DESKTOP",
  intervalHours: 6,
  maxRetries: 2,
  notifyOnRecovery: true,
  channelIds: [],
  viewport: { width: 1440, height: 900 },
  modelName: "gpt-5-mini",
  runnerVersion: "zenguy-runner/1.0.0",
};
const ACTIVE_RUN: TestRun = {
  id: "run_read_active",
  workspaceId: WORKSPACE.id,
  browserTestId: TEST.id,
  source: "MANUAL",
  status: "RUNNING",
  snapshot: SNAPSHOT,
  scheduledFor: null,
  queuedAt: NOW - 2_000,
  startedAt: NOW - 1_000,
  finishedAt: null,
  durationMs: null,
  attemptCount: 2,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: "ue_run_read",
  triggeredByUserId: USER.id,
  incidentId: null,
  createdAt: NOW + 2_000,
};
const FAILED_RUN: TestRun = {
  ...ACTIVE_RUN,
  id: "run_read_failed",
  status: "FAILED",
  source: "SCHEDULED",
  queuedAt: NOW - 20_000,
  startedAt: NOW - 19_000,
  finishedAt: NOW - 10_000,
  durationMs: 10_000,
  attemptCount: 1,
  usageEventId: "ue_run_failed",
  triggeredByUserId: null,
  createdAt: NOW + 1_000,
};
const ATTEMPT_ZERO: TestAttempt = {
  id: "att_read_zero",
  testRunId: ACTIVE_RUN.id,
  attemptIndex: 0,
  status: "FAILED",
  retryDelaySeconds: 0,
  queuedAt: NOW - 2_000,
  startedAt: NOW - 1_900,
  finishedAt: NOW - 1_500,
  durationMs: 400,
  summary: "First attempt failed",
  expectedResult: "Checkout succeeds",
  actualResult: "Button failed",
  failureReason: "Button disabled",
  visitedUrlsJson: JSON.stringify(["https://example.com/checkout"]),
  consoleErrorsJson: JSON.stringify([
    {
      level: "error",
      message: "checkout failed",
      url: "https://example.com/app.js",
      timestamp: new Date(NOW - 1_600).toISOString(),
    },
  ]),
  networkErrorsJson: JSON.stringify([
    {
      method: "POST",
      host: "example.com",
      path: "/api/checkout",
      statusCode: 500,
      errorType: null,
      durationMs: 50,
    },
  ]),
  tokenUsage: 120,
  inputTokens: 100,
  outputTokens: 20,
  modelName: "gpt-5-mini",
  runnerVersion: "zenguy-fallback-runner/2.0.0",
  runnerKind: "fallback",
  systemErrorCode: null,
  createdAt: NOW - 2_000,
};
const ATTEMPT_ONE: TestAttempt = {
  ...ATTEMPT_ZERO,
  id: "att_read_one",
  attemptIndex: 1,
  status: "RUNNING",
  retryDelaySeconds: 0,
  queuedAt: NOW - 1_400,
  startedAt: NOW - 1_300,
  finishedAt: null,
  durationMs: null,
  summary: null,
  actualResult: null,
  failureReason: null,
  createdAt: NOW - 1_400,
};
const FAILED_ATTEMPT: TestAttempt = {
  ...ATTEMPT_ZERO,
  id: "att_read_failed",
  testRunId: FAILED_RUN.id,
  attemptIndex: 0,
  queuedAt: FAILED_RUN.queuedAt,
  startedAt: FAILED_RUN.startedAt,
  finishedAt: FAILED_RUN.finishedAt,
  durationMs: FAILED_RUN.durationMs,
  createdAt: FAILED_RUN.queuedAt,
};
const OLD_SCREENSHOT_ID = "art_read_old";
const NEW_SCREENSHOT_ID = "art_read_new";
const FAILED_SCREENSHOT_ID = "art_read_failed";
const EXPIRED_SCREENSHOT_ID = "art_read_expired";
const REPORT_ID = "art_read_report";

function artifact(input: {
  id: string;
  runId: string;
  attemptId: string | null;
  type?: RunArtifact["type"];
  createdAt: number;
  expiresAt?: number;
  metadataJson?: string | null;
}): RunArtifact {
  const attemptId = input.attemptId ?? FAILED_ATTEMPT.id;
  const type = input.type ?? "SCREENSHOT";
  return {
    id: input.id,
    workspaceId: WORKSPACE.id,
    runId: input.runId,
    attemptId: input.attemptId,
    type,
    storageKey: artifactStorageKey({
      workspaceId: WORKSPACE.id,
      runId: input.runId,
      attemptId,
      artifactId: input.id,
      type,
    }),
    mimeType: type === "SCREENSHOT" ? "image/jpeg" : "text/markdown",
    sizeBytes: 0,
    metadataJson: input.metadataJson ?? null,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt ?? NOW + 86_400_000,
  };
}

const OLD_SCREENSHOT = artifact({
  id: OLD_SCREENSHOT_ID,
  runId: ACTIVE_RUN.id,
  attemptId: ATTEMPT_ONE.id,
  createdAt: NOW - 900,
});
const NEW_SCREENSHOT = artifact({
  id: NEW_SCREENSHOT_ID,
  runId: ACTIVE_RUN.id,
  attemptId: ATTEMPT_ONE.id,
  createdAt: NOW - 800,
});
const FAILED_SCREENSHOT = artifact({
  id: FAILED_SCREENSHOT_ID,
  runId: FAILED_RUN.id,
  attemptId: FAILED_ATTEMPT.id,
  createdAt: NOW - 9_000,
});
const EXPIRED_SCREENSHOT = artifact({
  id: EXPIRED_SCREENSHOT_ID,
  runId: FAILED_RUN.id,
  attemptId: FAILED_ATTEMPT.id,
  createdAt: NOW - 8_000,
  expiresAt: NOW - 1,
});
const REPORT = artifact({
  id: REPORT_ID,
  runId: FAILED_RUN.id,
  attemptId: null,
  type: "MARKDOWN_REPORT",
  createdAt: NOW - 7_000,
  metadataJson: JSON.stringify({
    filename: "checkout_2026-08-19_run_read_failed_failure-report.md",
  }),
});

describe("run read and artifact routes", () => {
  let app: Hono<AppEnv>;
  let authorization: string;
  let config: ReturnType<typeof loadConfig>;
  let runs: D1RunRepo;

  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
    const bindings = testEnv();
    config = loadConfig(bindings);
    const clock = new FixedClock(NOW);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    await users.insert(USER);
    await workspaces.insert(WORKSPACE);
    await workspaces.insert(OTHER_WORKSPACE);
    await members.insert({
      id: "mem_run_read",
      workspaceId: WORKSPACE.id,
      userId: USER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await members.insert({
      id: "mem_run_other",
      workspaceId: OTHER_WORKSPACE.id,
      userId: USER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    const tests = new D1BrowserTestRepo(bindings.DB);
    runs = new D1RunRepo(bindings.DB);
    const attempts = new D1AttemptRepo(bindings.DB);
    const steps = new D1StepRepo(bindings.DB);
    const artifacts = new D1ArtifactRepo(bindings.DB);
    await tests.insert(TEST);
    await runs.insert(FAILED_RUN);
    await runs.insert(ACTIVE_RUN);
    // Deliberately insert attempts out of index order; responses must sort them.
    await attempts.insert(ATTEMPT_ONE);
    await attempts.insert(ATTEMPT_ZERO);
    await attempts.insert(FAILED_ATTEMPT);
    const runSteps: RunStep[] = [
      {
        id: "step_read_one",
        attemptId: ATTEMPT_ONE.id,
        sequence: 1,
        timestamp: NOW - 900,
        actionType: "navigate",
        description: "Open checkout",
        urlSanitized: "https://example.com/checkout",
        result: "OK",
        artifactId: OLD_SCREENSHOT.id,
        createdAt: NOW - 900,
      },
      {
        id: "step_read_two",
        attemptId: ATTEMPT_ONE.id,
        sequence: 2,
        timestamp: NOW - 800,
        actionType: "click",
        description: "Click pay",
        urlSanitized: "https://example.com/checkout",
        result: "OK",
        artifactId: NEW_SCREENSHOT.id,
        createdAt: NOW - 800,
      },
    ];
    await steps.insertMany(runSteps);
    for (const value of [
      OLD_SCREENSHOT,
      NEW_SCREENSHOT,
      FAILED_SCREENSHOT,
      EXPIRED_SCREENSHOT,
      REPORT,
    ]) {
      await artifacts.insert(value);
    }
    const storage = new ArtifactStorage(bindings.ARTIFACTS);
    await storage.delete([
      OLD_SCREENSHOT.storageKey,
      NEW_SCREENSHOT.storageKey,
      FAILED_SCREENSHOT.storageKey,
      EXPIRED_SCREENSHOT.storageKey,
      REPORT.storageKey,
    ]);
    await storage.put(OLD_SCREENSHOT.storageKey, new Uint8Array([1]), "image/jpeg");
    await storage.put(
      NEW_SCREENSHOT.storageKey,
      new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]),
      "image/jpeg",
    );
    await storage.put(
      FAILED_SCREENSHOT.storageKey,
      new Uint8Array([9, 8, 7]),
      "image/jpeg",
    );
    await storage.put(
      EXPIRED_SCREENSHOT.storageKey,
      new Uint8Array([6]),
      "image/jpeg",
    );
    const reportMarkdown = [
      "# Failure report",
      `Current: {{ARTIFACT:${FAILED_SCREENSHOT.id}}}`,
      `Expired: {{ARTIFACT:${EXPIRED_SCREENSHOT.id}}}`,
      "Missing: {{ARTIFACT:art_does_not_exist}}",
    ].join("\n");
    await storage.put(
      REPORT.storageKey,
      new TextEncoder().encode(reportMarkdown),
      "text/markdown",
    );
    authorization = `Bearer ${await issueAccessToken(config, USER, clock)}`;
    app = buildApp(bindings, { clock });
  });

  it("lists with keyset/status filters and returns ordered run evidence", async () => {
    const first = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/runs?limit=1`,
      { headers: { Authorization: authorization } },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      data: { id: string; device: string; triggeredBy: unknown }[];
      nextCursor: string | null;
    };
    expect(firstBody).toMatchObject({
      data: [
        {
          id: ACTIVE_RUN.id,
          device: "DESKTOP",
          triggeredBy: { userId: USER.id, name: USER.name },
        },
      ],
      nextCursor: expect.any(String),
    });
    const second = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/runs?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      { headers: { Authorization: authorization } },
    );
    await expect(second.json()).resolves.toMatchObject({
      data: [{ id: FAILED_RUN.id }],
      nextCursor: null,
    });
    const filtered = await app.request(
      `/api/workspaces/${WORKSPACE.id}/browser-tests/${TEST.id}/runs?status=FAILED`,
      { headers: { Authorization: authorization } },
    );
    await expect(filtered.json()).resolves.toMatchObject({
      data: [{ id: FAILED_RUN.id, status: "FAILED" }],
    });

    const detail = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${ACTIVE_RUN.id}`,
      { headers: { Authorization: authorization } },
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: {
        attempts: {
          id: string;
          attemptIndex: number;
          latestStep: { description: string } | null;
          latestScreenshot: { id: string; url: string } | null;
        }[];
        live: { url: string } | null;
      };
    };
    expect(detailBody.data.attempts.map(({ attemptIndex }) => attemptIndex)).toEqual([
      0, 1,
    ]);
    expect(detailBody.data.attempts[1]).toMatchObject({
      latestStep: { description: "Click pay" },
      latestScreenshot: { id: NEW_SCREENSHOT.id },
    });
    // The run view tells who executed each attempt and what it cost.
    expect(detailBody.data.attempts[0]).toMatchObject({
      tokenUsage: 120,
      inputTokens: 100,
      outputTokens: 20,
      modelName: "gpt-5-mini",
      runnerKind: "fallback",
      runnerVersion: "zenguy-fallback-runner/2.0.0",
    });
    expect(detailBody.data.attempts[1]?.latestScreenshot?.url).toContain(
      `/api/artifact-content?id=${NEW_SCREENSHOT.id}`,
    );
    expect(detailBody.data.live?.url).toContain(
      `/api/workspaces/${WORKSPACE.id}/runs/${ACTIVE_RUN.id}/events?`,
    );

    const attempt = await app.request(
      `/api/workspaces/${WORKSPACE.id}/attempts/${ATTEMPT_ONE.id}`,
      { headers: { Authorization: authorization } },
    );
    expect(attempt.status).toBe(200);
    await expect(attempt.json()).resolves.toMatchObject({
      data: {
        id: ATTEMPT_ONE.id,
        tokenUsage: 120,
        inputTokens: 100,
        outputTokens: 20,
        runnerKind: "fallback",
        visitedUrls: ["https://example.com/checkout"],
        consoleErrors: [{ message: "checkout failed" }],
        networkErrors: [{ method: "POST", statusCode: 500 }],
        steps: [
          { sequence: 1, screenshot: { id: OLD_SCREENSHOT.id } },
          { sequence: 2, screenshot: { id: NEW_SCREENSHOT.id } },
        ],
        screenshots: [{ id: OLD_SCREENSHOT.id }, { id: NEW_SCREENSHOT.id }],
      },
    });

    for (const path of [
      `/api/workspaces/${OTHER_WORKSPACE.id}/runs/${ACTIVE_RUN.id}`,
      `/api/workspaces/${OTHER_WORKSPACE.id}/attempts/${ATTEMPT_ONE.id}`,
    ]) {
      const crossWorkspace = await app.request(path, {
        headers: { Authorization: authorization },
      });
      expect(crossWorkspace.status).toBe(404);
    }
  });

  it("serves valid signed artifacts without auth and hides invalid signatures", async () => {
    const signed = await signArtifactUrl(config, NEW_SCREENSHOT.id, NOW);
    const response = await app.request(signed);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("Content-Disposition")).toBe("inline");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]),
    );

    const tampered = new URL(signed, "https://app.zenguy.test");
    tampered.searchParams.set("sig", "tampered");
    const tamperedResponse = await app.request(
      `${tampered.pathname}${tampered.search}`,
    );
    expect(tamperedResponse.status).toBe(404);

    const expired = await signArtifactUrl(
      config,
      NEW_SCREENSHOT.id,
      NOW - (ARTIFACT_SIG_TTL_SECONDS + 1) * 1_000,
    );
    const expiredResponse = await app.request(expired);
    expect(expiredResponse.status).toBe(404);
  });

  it("authenticates SSE with its URL token and streams a terminal update", async () => {
    const detail = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${ACTIVE_RUN.id}`,
      { headers: { Authorization: authorization } },
    );
    const detailBody = (await detail.json()) as {
      data: { live: { url: string } | null };
    };
    const liveUrl = detailBody.data.live?.url;
    expect(liveUrl).toBeDefined();

    const tampered = new URL(liveUrl ?? "", "https://app.zenguy.test");
    tampered.searchParams.set("sig", "tampered");
    const tamperedResponse = await app.request(
      `${tampered.pathname}${tampered.search}`,
    );
    expect(tamperedResponse.status).toBe(404);

    const crossWorkspace = new URL(liveUrl ?? "", "https://app.zenguy.test");
    crossWorkspace.pathname = crossWorkspace.pathname.replace(
      WORKSPACE.id,
      OTHER_WORKSPACE.id,
    );
    const crossWorkspaceResponse = await app.request(
      `${crossWorkspace.pathname}${crossWorkspace.search}`,
    );
    expect(crossWorkspaceResponse.status).toBe(404);

    const expiredAt = Math.floor(NOW / 1_000) - 1;
    const expiredSig = await hmacSign(
      config.artifactUrlSecret,
      `sse.${ACTIVE_RUN.id}.${expiredAt}`,
    );
    const expiredResponse = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${ACTIVE_RUN.id}/events?exp=${expiredAt}&sig=${encodeURIComponent(expiredSig)}`,
    );
    expect(expiredResponse.status).toBe(404);

    await runs.finalize(ACTIVE_RUN.id, {
      status: "PASSED",
      finishedAt: NOW,
      durationMs: 2_000,
      attemptCount: 2,
      passedAfterRetry: true,
      billable: true,
    });
    const stream = await app.request(liveUrl ?? "");
    expect(stream.status).toBe(200);
    expect(stream.headers.get("Content-Type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    const body = await stream.text();
    expect(body).toContain("retry: 3000\n\n");
    expect(body).toContain("event: update\n");
    expect(body).toContain('"status":"PASSED"');
    expect(body).toContain("event: done\ndata: {}\n\n");
  });

  it("downloads a report with fresh evidence URLs and expired markers", async () => {
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${FAILED_RUN.id}/report`,
      { headers: { Authorization: authorization } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="checkout_2026-08-19_run_read_failed_failure-report.md"',
    );
    const markdown = await response.text();
    expect(markdown).toContain(
      `/api/artifact-content?id=${FAILED_SCREENSHOT.id}`,
    );
    expect(markdown.match(/\*\(artifact expired\)\*/gu)).toHaveLength(2);
    expect(markdown).not.toContain("{{ARTIFACT:");

    const missing = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${ACTIVE_RUN.id}/report`,
      { headers: { Authorization: authorization } },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Report not available" },
    });
  });

  it("rate limits report downloads by workspace", async () => {
    const path =
      `/api/workspaces/${WORKSPACE.id}/runs/${FAILED_RUN.id}/report`;
    for (let count = 0; count < RATE_LIMITS.report_download.limit; count += 1) {
      const response = await app.request(path, {
        headers: { Authorization: authorization },
      });
      expect(response.status).toBe(200);
    }
    const limited = await app.request(path, {
      headers: { Authorization: authorization },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/u);
    await expect(limited.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });
});
