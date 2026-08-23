import type {
  RunArtifact,
  TestRun,
} from "../../domain/browser_tests/types";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import { FixedClock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import type { RateLimiter } from "../../shared/ratelimit";
import { FakeTrackEvent } from "../../test/fakes/activity";
import {
  FakeArtifactRepo,
  FakeRunRepo,
} from "../../test/fakes/browser_test_repos";
import {
  DownloadReport,
  MAX_REPORT_ARTIFACT_REFERENCES,
} from "./download_report";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const WORKSPACE_ID = "ws_report_cap";
const RUN_ID = "run_report_cap";

function run(): TestRun {
  return {
    id: RUN_ID,
    workspaceId: WORKSPACE_ID,
    browserTestId: "bt_report_cap",
    source: "MANUAL",
    status: "FAILED",
    snapshot: {
      name: "Report cap",
      startUrl: "https://example.com",
      instructions: "Check it",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 0,
      notifyOnRecovery: false,
      channelIds: [],
      viewport: { width: 1440, height: 900 },
      modelName: "test-model",
      runnerVersion: "test-runner",
    },
    scheduledFor: null,
    queuedAt: NOW,
    startedAt: NOW,
    finishedAt: NOW + 1,
    durationMs: 1,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: null,
    incidentId: null,
    createdAt: NOW,
  };
}

function artifact(id: string, type: RunArtifact["type"]): RunArtifact {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    attemptId: null,
    type,
    storageKey: `artifacts/${id}`,
    mimeType: type === "MARKDOWN_REPORT" ? "text/markdown" : "image/jpeg",
    sizeBytes: 1,
    metadataJson: type === "MARKDOWN_REPORT" ? '{"filename":"report.md"}' : null,
    createdAt: NOW,
    expiresAt: NOW + 60_000,
  };
}

describe("DownloadReport artifact references", () => {
  it("batches and caps report artifact lookups", async () => {
    const runs = new FakeRunRepo();
    const artifacts = new FakeArtifactRepo();
    await runs.insert(run());
    const report = artifact("art_report", "MARKDOWN_REPORT");
    await artifacts.insert(report);
    const screenshotIds = Array.from(
      { length: MAX_REPORT_ARTIFACT_REFERENCES + 5 },
      (_, index) => `art_screen_${index}`,
    );
    for (const id of screenshotIds) {
      await artifacts.insert(artifact(id, "SCREENSHOT"));
    }
    const markdown = screenshotIds
      .map((id) => `Evidence: {{ARTIFACT:${id}}}`)
      .join("\n");
    const storage = {
      get: vi.fn(async () => ({ text: async () => markdown })),
    } as unknown as Pick<ArtifactStorage, "get">;
    const limiter: RateLimiter = {
      hit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 })),
    };
    const findByIds = vi.spyOn(artifacts, "findByIds");
    const findById = vi.spyOn(artifacts, "findById");
    const service = new DownloadReport(
      runs,
      artifacts,
      storage,
      limiter,
      { artifactUrlSecret: "a".repeat(32) },
      new FixedClock(NOW),
    );

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      actorId: "usr_report",
      ip: "203.0.113.42",
    });

    expect(limiter.hit).toHaveBeenCalledTimes(3);
    expect(limiter.hit).toHaveBeenCalledWith(
      `report_download:workspace:${WORKSPACE_ID}`,
      expect.any(Number),
      expect.any(Number),
    );
    expect(limiter.hit).toHaveBeenCalledWith(
      "report_download:actor:usr_report",
      expect.any(Number),
      expect.any(Number),
    );
    expect(limiter.hit).toHaveBeenCalledWith(
      `report_download:ip:${await sha256Hex("203.0.113.42")}`,
      expect.any(Number),
      expect.any(Number),
    );
    expect(findByIds).toHaveBeenCalledOnce();
    expect(findByIds.mock.calls[0]?.[0]).toHaveLength(
      MAX_REPORT_ARTIFACT_REFERENCES,
    );
    expect(findById).not.toHaveBeenCalled();
    expect(result.markdown.match(/\/api\/artifact-content\?/gu)).toHaveLength(
      MAX_REPORT_ARTIFACT_REFERENCES,
    );
    expect(result.markdown.match(/\*\(artifact expired\)\*/gu)).toHaveLength(5);
    expect(result.markdown).not.toContain("{{ARTIFACT:");
  });
});

describe("DownloadReport activity", () => {
  const limiter: RateLimiter = {
    hit: async () => ({ allowed: true, retryAfterSeconds: 1 }),
  };

  async function fixture(track: FakeTrackEvent, withReport = true) {
    const runs = new FakeRunRepo();
    const artifacts = new FakeArtifactRepo();
    await runs.insert(run());
    if (withReport) await artifacts.insert(artifact("art_report", "MARKDOWN_REPORT"));
    const storage = {
      get: async () => ({ text: async () => "# Report" }),
    } as unknown as Pick<ArtifactStorage, "get">;
    return new DownloadReport(
      runs,
      artifacts,
      storage,
      limiter,
      { artifactUrlSecret: "a".repeat(32) },
      new FixedClock(NOW),
      track,
    );
  }

  it("records report.downloaded for the run once the report is served", async () => {
    const track = new FakeTrackEvent();
    const service = await fixture(track);

    await service.execute({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      actorId: "usr_report",
    });

    expect(track.calls).toEqual([
      {
        type: "report.downloaded",
        userId: "usr_report",
        workspaceId: WORKSPACE_ID,
        source: "server",
        resourceId: RUN_ID,
        properties: { browserTestId: "bt_report_cap" },
      },
    ]);
  });

  it("records nothing when the report is not available", async () => {
    const track = new FakeTrackEvent();
    const service = await fixture(track, false);

    await expect(
      service.execute({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        actorId: "usr_report",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(track.calls).toEqual([]);
  });
});
