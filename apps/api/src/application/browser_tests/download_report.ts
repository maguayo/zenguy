import type {
  ArtifactRepo,
  RunRepo,
} from "../../domain/browser_tests/repo";
import { signArtifactUrl } from "../../http/artifact_sign";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { RATE_LIMITS } from "../../shared/constants";
import { AppError, notFound } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";

const ARTIFACT_PLACEHOLDER = /\{\{ARTIFACT:([^{}]+)\}\}/gu;

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
  ) {}

  async execute(input: {
    workspaceId: string;
    runId: string;
  }): Promise<{ markdown: string; filename: string }> {
    const run = await this.runs.findById(input.workspaceId, input.runId);
    if (run === null) throw notFound("Run");
    const rate = await this.rateLimiter.hit(
      `report_download:${input.workspaceId}`,
      RATE_LIMITS.report_download.limit,
      RATE_LIMITS.report_download.windowSeconds,
    );
    if (!rate.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests",
        undefined,
        rate.retryAfterSeconds,
      );
    }
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
    const ids = [
      ...new Set([...markdown.matchAll(ARTIFACT_PLACEHOLDER)].map((match) => match[1])),
    ];
    const replacements = new Map<string, string>();
    await Promise.all(
      ids.map(async (artifactId) => {
        if (artifactId === undefined) return;
        const artifact = await this.artifacts.findById(artifactId);
        replacements.set(
          artifactId,
          artifact !== null &&
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
