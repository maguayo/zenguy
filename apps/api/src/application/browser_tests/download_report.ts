import type { TrackEvent } from "../activity/track_event";
import { ACTIVITY_EVENTS } from "../../domain/activity/catalog";
import type {
  ArtifactRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { signArtifactUrl } from "../../http/artifact_sign";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import { AppError, notFound } from "../../shared/errors";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";

const ARTIFACT_PLACEHOLDER = /\{\{ARTIFACT:([^{}]+)\}\}/gu;
export const MAX_REPORT_ARTIFACT_REFERENCES = 50;

function reportNotAvailable(): AppError {
  return new AppError("NOT_FOUND", "Report not available");
}

function filenameFromMetadata(metadataJson: string | null): string {
  if (metadataJson === null) return "report.md";
  try {
    const metadata: unknown = JSON.parse(metadataJson);
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      !("filename" in metadata) ||
      typeof metadata.filename !== "string" ||
      metadata.filename.trim().length === 0
    ) {
      return "report.md";
    }
    return metadata.filename.replace(/[\r\n"\\]/gu, "_");
  } catch {
    return "report.md";
  }
}

export class DownloadReport {
  constructor(
    private readonly runs: RunRepo,
    private readonly artifacts: ArtifactRepo,
    private readonly storage: Pick<ArtifactStorage, "get">,
    private readonly rateLimiter: RateLimiter,
    private readonly config: Pick<AppConfig, "artifactUrlSecret">,
    private readonly clock: Clock,
    private readonly track?: Pick<TrackEvent, "execute">,
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
    actorId: string;
    ip?: string;
  }): Promise<{ markdown: string; filename: string }> {
    await enforceRateLimitScopes(
      this.rateLimiter,
      [
        `report_download:workspace:${input.workspaceId}`,
        `report_download:actor:${input.actorId}`,
        `report_download:ip:${await sha256Hex(normalizeRateLimitAddress(input.ip))}`,
      ],
      RATE_LIMITS.report_download,
    );
    const run = await this.runs.findById(input.workspaceId, input.runId);
    if (run === null) throw notFound("Run");
    const now = this.clock.now();
    const report = await this.artifacts.findReportForRun(run.id);
    if (
      report === null ||
      report.workspaceId !== input.workspaceId ||
      report.expiresAt <= now
    ) {
      throw reportNotAvailable();
    }
    const object = await this.storage.get(report.storageKey);
    if (object === null) throw reportNotAvailable();
    const markdown = await object.text();
    // Recorded once the report body is in hand: a missing or expired report
    // is a 404, not a download.
    await this.track?.execute({
      type: ACTIVITY_EVENTS.reportDownloaded,
      userId: input.actorId,
      workspaceId: run.workspaceId,
      source: "server",
      resourceId: run.id,
      properties: { browserTestId: run.browserTestId },
    });
    const allIds = [
      ...new Set([...markdown.matchAll(ARTIFACT_PLACEHOLDER)].map((match) => match[1])),
    ];
    const ids = allIds
      .filter((artifactId): artifactId is string => artifactId !== undefined)
      .slice(0, MAX_REPORT_ARTIFACT_REFERENCES);
    const replacements = new Map<string, string>();
    const artifacts = await this.artifacts.findByIds(ids);
    await Promise.all(
      artifacts.map(async (artifact) => {
        replacements.set(
          artifact.id,
          artifact.workspaceId === input.workspaceId &&
            artifact.runId === run.id &&
            artifact.expiresAt > now
            ? await signArtifactUrl(this.config, artifact.id, now)
            : "*(artifact expired)*",
        );
      }),
    );
    return {
      markdown: markdown.replace(
        ARTIFACT_PLACEHOLDER,
        (_placeholder, artifactId: string) =>
          replacements.get(artifactId) ?? "*(artifact expired)*",
      ),
      filename: filenameFromMetadata(report.metadataJson),
    };
  }
}
