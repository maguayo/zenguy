import { buildApp } from "../../app";
import type {
  RunArtifact,
  RunStep,
  TestAttempt,
  TestRun,
} from "../../domain/browser_tests/types";
import type { User } from "../../domain/users/types";
import type { Workspace } from "../../domain/workspaces/types";
import { issueAccessToken } from "../../infrastructure/auth/jwt";
import { D1ArtifactRepo } from "../../infrastructure/db/artifact_repo";
import { D1AttemptRepo } from "../../infrastructure/db/attempt_repo";
import { D1MemberRepo } from "../../infrastructure/db/member_repo";
import { D1RunRepo } from "../../infrastructure/db/run_repo";
import { D1SecretRepo } from "../../infrastructure/db/secret_repo";
import { D1StepRepo } from "../../infrastructure/db/step_repo";
import { D1UserRepo } from "../../infrastructure/db/user_repo";
import { D1WorkspaceRepo } from "../../infrastructure/db/workspace_repo";
import {
  ArtifactStorage,
  artifactStorageKey,
} from "../../infrastructure/storage/artifacts";
import { FixedClock } from "../../shared/clock";
import { loadConfig } from "../../shared/config";
import { FakeIds } from "../../test/fakes/ids";
import { freshDb, freshKv, testEnv } from "../../test/helpers";
import { ResolveSecrets } from "../secrets/resolve_secrets";
import { GenerateReport, REPORT_FOOTER } from "./generate_report";

const NOW = Date.now();
const REPORT_DATE = new Date(NOW).toISOString().slice(0, 10);
const USER: User = {
  id: "usr_report_e2e",
  name: "Report Reader",
  email: "report-reader@zenguy.test",
  passwordHash: "unused",
  emailVerifiedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};
const WORKSPACE: Workspace = {
  id: "ws_report_e2e",
  name: "Report E2E",
  slug: "report-e2e",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const RUN: TestRun = {
  id: "run_report_e2e",
  workspaceId: WORKSPACE.id,
  browserTestId: "bt_report_e2e",
  source: "MANUAL",
  status: "FAILED",
  snapshot: {
    name: "Checkout End to End",
    startUrl: "https://example.com/checkout",
    instructions: "Verify checkout completes.",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "zenguy-runner/1.0.0",
  },
  scheduledFor: null,
  queuedAt: NOW - 10_000,
  startedAt: NOW - 9_000,
  finishedAt: NOW - 1_000,
  durationMs: 9_000,
  attemptCount: 1,
  infraAttempts: 0,
  passedAfterRetry: false,
  billable: true,
  usageEventId: "ue_report_e2e",
  triggeredByUserId: USER.id,
  incidentId: "inc_report_e2e",
  createdAt: NOW - 10_000,
};
const ATTEMPT: TestAttempt = {
  id: "att_report_e2e",
  testRunId: RUN.id,
  attemptIndex: 0,
  status: "FAILED",
  retryDelaySeconds: 0,
  queuedAt: RUN.queuedAt,
  startedAt: RUN.startedAt,
  finishedAt: RUN.finishedAt,
  durationMs: RUN.durationMs,
  summary: "Checkout failed",
  expectedResult: "Checkout succeeds",
  actualResult: "Checkout stayed open",
  failureReason: "Confirmation was not visible",
  visitedUrlsJson: JSON.stringify([RUN.snapshot.startUrl]),
  consoleErrorsJson: "[]",
  networkErrorsJson: "[]",
  tokenUsage: 456,
  modelName: RUN.snapshot.modelName,
  runnerVersion: RUN.snapshot.runnerVersion,
  systemErrorCode: null,
  createdAt: RUN.queuedAt,
};
const SCREENSHOT: RunArtifact = {
  id: "art_report_e2e_screenshot",
  workspaceId: WORKSPACE.id,
  runId: RUN.id,
  attemptId: ATTEMPT.id,
  type: "SCREENSHOT",
  storageKey: artifactStorageKey({
    workspaceId: WORKSPACE.id,
    runId: RUN.id,
    attemptId: ATTEMPT.id,
    artifactId: "art_report_e2e_screenshot",
    type: "SCREENSHOT",
  }),
  mimeType: "image/jpeg",
  sizeBytes: 4,
  metadataJson: JSON.stringify({ sequence: 1 }),
  createdAt: NOW - 2_000,
  expiresAt: NOW + 86_400_000,
};
const STEP: RunStep = {
  id: "step_report_e2e",
  attemptId: ATTEMPT.id,
  sequence: 1,
  timestamp: NOW - 2_000,
  actionType: "finish",
  description: "Finished after observing the missing confirmation",
  urlSanitized: RUN.snapshot.startUrl,
  result: "OK",
  artifactId: SCREENSHOT.id,
  createdAt: NOW - 2_000,
};

describe("generated report download", () => {
  beforeEach(async () => {
    await Promise.all([freshDb(), freshKv()]);
  });

  it("generates to R2 and downloads through the authenticated HTTP endpoint", async () => {
    const bindings = testEnv();
    const config = loadConfig(bindings);
    const clock = new FixedClock(NOW);
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    const runs = new D1RunRepo(bindings.DB);
    const attempts = new D1AttemptRepo(bindings.DB);
    const steps = new D1StepRepo(bindings.DB);
    const artifacts = new D1ArtifactRepo(bindings.DB);
    const storage = new ArtifactStorage(bindings.ARTIFACTS);
    await users.insert(USER);
    await workspaces.insert(WORKSPACE);
    await members.insert({
      id: "mem_report_e2e",
      workspaceId: WORKSPACE.id,
      userId: USER.id,
      role: "OWNER",
      invitedBy: null,
      joinedAt: NOW,
    });
    await runs.insert(RUN);
    await attempts.insert(ATTEMPT);
    await steps.insertMany([STEP]);
    await artifacts.insert(SCREENSHOT);
    await storage.put(
      SCREENSHOT.storageKey,
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      "image/jpeg",
    );
    const generator = new GenerateReport({
      attempts,
      steps,
      artifacts,
      workspaces,
      resolveSecrets: new ResolveSecrets(
        new D1SecretRepo(bindings.DB),
        config.encryptionKey,
      ),
      storage,
      clock,
      ids: new FakeIds(),
    });

    const report = await generator.generateForRun(RUN);
    expect(report).not.toBeNull();
    const app = buildApp(bindings, { clock });
    const authorization = `Bearer ${await issueAccessToken(config, USER, clock)}`;
    const response = await app.request(
      `/api/workspaces/${WORKSPACE.id}/runs/${RUN.id}/report`,
      { headers: { Authorization: authorization } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="checkout-end-to-end_${REPORT_DATE}_run_report_e2e_failure-report.md"`,
    );
    const markdown = await response.text();
    expect(markdown).toContain("# Test failure report: Checkout End to End");
    expect(markdown).toContain(
      `/api/artifact-content?id=${SCREENSHOT.id}`,
    );
    expect(markdown).not.toContain("{{ARTIFACT:");
    expect(markdown.endsWith(`${REPORT_FOOTER}\n`)).toBe(true);
  });
});
