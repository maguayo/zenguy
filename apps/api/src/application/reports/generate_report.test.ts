import type {
  RunArtifact,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { Workspace } from "../../domain/workspaces/types";
import { FixedClock } from "../../shared/clock";
import { RETENTION_DAYS } from "../../shared/constants";
import {
  FakeArtifactRepo,
  FakeAttemptRepo,
  FakeStepRepo,
} from "../../test/fakes/browser_test_repos";
import { FakeIds } from "../../test/fakes/ids";
import { FakeWorkspaceRepo } from "../../test/fakes/repos";
import { GenerateReport, REPORT_FOOTER } from "./generate_report";

const NOW = Date.UTC(2026, 7, 19, 12, 30, 0);
const SECRET = "raw-super-secret";
const WORKSPACE: Workspace = {
  id: "ws_report",
  name: "Report Workspace",
  slug: "report-workspace",
  timezone: "Europe/Madrid",
  ownerUserId: "usr_owner",
  createdAt: NOW - 100_000,
  updatedAt: NOW - 100_000,
  deletedAt: null,
};
const RUN: TestRun = {
  id: "run_report_failure",
  workspaceId: WORKSPACE.id,
  browserTestId: "bt_report",
  source: "SCHEDULED",
  status: "TIMEOUT",
  snapshot: {
    name: "Chéckout Flow",
    startUrl:
      "https://shop.example.com/start?token={{API_TOKEN}}&view=full",
    instructions:
      "Use {{API_TOKEN}} to begin.\nThen verify the `checkout` result.",
    device: "MOBILE",
    intervalHours: 12,
    maxRetries: 1,
    notifyOnRecovery: true,
    channelIds: ["ch_ops"],
    viewport: { width: 390, height: 844 },
    modelName: "gpt-5-mini",
    runnerVersion: "zenguy-runner/1.0.0",
  },
  scheduledFor: NOW - 180_000,
  queuedAt: NOW - 120_000,
  startedAt: NOW - 119_000,
  finishedAt: NOW - 1_000,
  durationMs: 119_000,
  attemptCount: 2,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: "ue_report",
  triggeredByUserId: null,
  incidentId: "inc_report",
  createdAt: NOW - 120_000,
};

function attempt(input: {
  id: string;
  index: number;
  status: "FAILED" | "TIMEOUT";
  queuedAt: number;
  retryDelay: number;
  reason: string;
  tokenUsage: number;
}): TestAttempt {
  return {
    id: input.id,
    testRunId: RUN.id,
    attemptIndex: input.index,
    status: input.status,
    retryDelaySeconds: input.retryDelay,
    queuedAt: input.queuedAt,
    startedAt: input.queuedAt + 1_000,
    finishedAt: input.queuedAt + 31_000,
    durationMs: 30_000,
    summary: `Observed checkout failure with ${SECRET}`,
    expectedResult: "The checkout confirmation is visible",
    actualResult: `The page showed ${SECRET} rejected`,
    failureReason: input.reason,
    visitedUrlsJson: JSON.stringify([
      `https://shop.example.com/checkout?note=${encodeURIComponent(SECRET)}`,
    ]),
    consoleErrorsJson: JSON.stringify([
      {
        level: "error",
        message: `Request rejected for ${SECRET}`,
        url: "https://shop.example.com/app.js",
        timestamp: new Date(input.queuedAt + 2_000).toISOString(),
      },
    ]),
    networkErrorsJson: JSON.stringify([
      {
        method: "POST",
        host: "shop.example.com",
        path: `/api/${SECRET}`,
        statusCode: 503,
        errorType: `upstream rejected ${SECRET}`,
        durationMs: 250,
      },
    ]),
    tokenUsage: input.tokenUsage,
    modelName: RUN.snapshot.modelName,
    runnerVersion: RUN.snapshot.runnerVersion,
    systemErrorCode: null,
    createdAt: input.queuedAt,
  };
}

const ATTEMPT_ZERO = attempt({
  id: "att_report_zero",
  index: 0,
  status: "FAILED",
  queuedAt: NOW - 120_000,
  retryDelay: 0,
  reason: `Button rejected ${SECRET}`,
  tokenUsage: 100,
});
const ATTEMPT_ONE = attempt({
  id: "att_report_one",
  index: 1,
  status: "TIMEOUT",
  queuedAt: NOW - 60_000,
  retryDelay: 60,
  reason: `Timed out after using ${SECRET}`,
  tokenUsage: 150,
});

function screenshot(
  id: string,
  attemptId: string,
  sequence: number,
): RunArtifact {
  return {
    id,
    workspaceId: WORKSPACE.id,
    runId: RUN.id,
    attemptId,
    type: "SCREENSHOT",
    storageKey: `screenshots/${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 10,
    metadataJson: JSON.stringify({ sequence }),
    createdAt: NOW - 50_000 + sequence,
    expiresAt: NOW + 86_400_000,
  };
}

class StaticResolver {
  readonly calls: Array<{ workspaceId: string; referencedKeys: string[] }> = [];

  async execute(input: {
    workspaceId: string;
    referencedKeys: string[];
  }): Promise<ResolvedSecrets> {
    this.calls.push(structuredClone(input));
    return new Map([
      [
        "API_TOKEN",
        { value: SECRET, allowedDomains: ["shop.example.com"] },
      ],
    ]);
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

async function fixture() {
  const attempts = new FakeAttemptRepo();
  const steps = new FakeStepRepo();
  const artifacts = new FakeArtifactRepo();
  const workspaces = new FakeWorkspaceRepo();
  const resolveSecrets = new StaticResolver();
  const storage = new RecordingStorage();
  await workspaces.insert(WORKSPACE);
  const generator = new GenerateReport({
    attempts,
    steps,
    artifacts,
    workspaces,
    resolveSecrets,
    storage,
    clock: new FixedClock(NOW),
    ids: new FakeIds(),
  });
  return {
    attempts,
    steps,
    artifacts,
    workspaces,
    resolveSecrets,
    storage,
    generator,
  };
}

describe("GenerateReport", () => {
  it("renders and stores the complete factual report with every secret redacted", async () => {
    const value = await fixture();
    await value.attempts.insert(ATTEMPT_ZERO);
    await value.attempts.insert(ATTEMPT_ONE);
    const steps: RunStep[] = [
      {
        id: "step_report_zero",
        attemptId: ATTEMPT_ZERO.id,
        sequence: 1,
        timestamp: NOW - 118_000,
        actionType: "click",
        description: `Clicked checkout using ${SECRET}`,
        urlSanitized: `https://shop.example.com/cart?note=${SECRET}`,
        result: "OK",
        artifactId: "art_screen_zero",
        createdAt: NOW - 118_000,
      },
      {
        id: "step_report_one",
        attemptId: ATTEMPT_ONE.id,
        sequence: 2,
        timestamp: NOW - 58_000,
        actionType: "wait",
        description: `Waited after ${SECRET}`,
        urlSanitized: "https://shop.example.com/cart",
        result: "ERROR",
        artifactId: "art_screen_one",
        createdAt: NOW - 58_000,
      },
    ];
    await value.steps.insertMany(steps);
    await value.artifacts.insert(
      screenshot("art_screen_zero", ATTEMPT_ZERO.id, 1),
    );
    await value.artifacts.insert(
      screenshot("art_screen_one", ATTEMPT_ONE.id, 2),
    );

    const report = await value.generator.generateForRun(RUN);

    expect(report).toMatchObject({
      type: "MARKDOWN_REPORT",
      attemptId: ATTEMPT_ONE.id,
      mimeType: "text/markdown",
      expiresAt: NOW + RETENTION_DAYS * 86_400_000,
    });
    expect(JSON.parse(report?.metadataJson ?? "{}")).toEqual({
      filename:
        "checkout-flow_2026-08-19_run_report_failure_failure-report.md",
    });
    expect(value.resolveSecrets.calls).toEqual([
      { workspaceId: WORKSPACE.id, referencedKeys: ["API_TOKEN"] },
    ]);
    const stored = value.storage.objects.get(report?.storageKey ?? "");
    expect(stored?.contentType).toBe("text/markdown");
    const markdown = new TextDecoder().decode(stored?.bytes);
    expect(markdown).not.toContain(SECRET);
    expect(markdown).toContain("{{API_TOKEN}}");
    expect(markdown).toContain(
      "- Attempt 0, step 1: {{ARTIFACT:art_screen_zero}}",
    );
    expect(markdown).toContain(
      "- Attempt 1, step 2: {{ARTIFACT:art_screen_one}}",
    );
    expect(markdown.endsWith(`${REPORT_FOOTER}\n`)).toBe(true);
    const headings = [
      "## Instructions",
      "## Result",
      "## Failure summary",
      "## Expected",
      "## Observed",
      "## Steps",
      "## Visited URLs",
      "## Console errors",
      "## Network errors",
      "## Screenshots",
      "## Retries",
      "## Technical metadata",
    ];
    expect(headings.map((heading) => markdown.indexOf(heading))).toEqual(
      [...headings.map((heading) => markdown.indexOf(heading))].sort(
        (left, right) => left - right,
      ),
    );
    expect(markdown).toMatchSnapshot();
  });

  it("refuses PASSED runs without resolving secrets or writing artifacts", async () => {
    const value = await fixture();

    await expect(
      value.generator.generateForRun({ ...RUN, status: "PASSED" }),
    ).resolves.toBeNull();

    expect(value.resolveSecrets.calls).toEqual([]);
    expect(value.storage.objects.size).toBe(0);
    expect(value.artifacts.artifacts.size).toBe(0);
  });

  it("returns an existing report without writing a duplicate", async () => {
    const value = await fixture();
    const existing: RunArtifact = {
      id: "art_existing_report",
      workspaceId: WORKSPACE.id,
      runId: RUN.id,
      attemptId: ATTEMPT_ONE.id,
      type: "MARKDOWN_REPORT",
      storageKey: "existing/report.md",
      mimeType: "text/markdown",
      sizeBytes: 100,
      metadataJson: JSON.stringify({ filename: "existing.md" }),
      createdAt: NOW - 1,
      expiresAt: NOW + 1,
    };
    await value.artifacts.insert(existing);

    await expect(value.generator.generateForRun(RUN)).resolves.toEqual(existing);
    expect(value.resolveSecrets.calls).toEqual([]);
    expect(value.storage.objects.size).toBe(0);
  });

  it("converges concurrent finalization resumes on one report artifact", async () => {
    const value = await fixture();
    await value.attempts.insert(ATTEMPT_ZERO);
    await value.attempts.insert(ATTEMPT_ONE);

    const reports = await Promise.all([
      value.generator.generateForRun(RUN),
      value.generator.generateForRun(RUN),
    ]);

    expect(reports[0]).not.toBeNull();
    expect(reports[1]?.id).toBe(reports[0]?.id);
    expect(
      [...value.artifacts.artifacts.values()].filter(
        (artifact) => artifact.type === "MARKDOWN_REPORT",
      ),
    ).toHaveLength(1);
    expect(value.storage.objects.size).toBe(1);
  });
});
